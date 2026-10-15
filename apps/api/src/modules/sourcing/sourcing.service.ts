import { createHash } from "node:crypto";
import { Injectable, OnModuleInit } from "@nestjs/common";
import type { DesignOwnership, Prisma, ProjectStage, RiskLevel, SourcingProjectStatus, WorkflowInstance } from "@sqms/db";
import { canonicalJson, computeRisk, evaluateApplicability, RISK_FACTORS, RiskModelError, type RiskSelections } from "@sqms/shared";
import type { Actor } from "../../common/auth/actor";
import { AccessScope } from "../../common/auth/access-scope";
import { ActivityService } from "../../common/audit/activity.service";
import { AuditService, diffControlled } from "../../common/audit/audit.service";
import { DbService, type AfterCommit, type Tx } from "../../common/db/db.service";
import { BusinessRuleError, ForbiddenError, InvalidTransitionError, NotFoundError, StaleVersionError } from "../../common/errors/app-errors";
import { toDate } from "../../common/http/dto-helpers";
import { pageArgs, sortArg, trimQ, type Page } from "../../common/http/pagination";
import { NotificationService } from "../../common/services/notification.service";
import { NumberingService } from "../../common/services/numbering.service";
import { OutboxService } from "../../common/services/outbox.service";
import { ConfigurationsService } from "../configurations/configurations.service";
import { DocumentsService } from "../documents/documents.service";
import { WorkflowService, type WorkflowSubjectHandler } from "../workflow/workflow.service";
import { ChecklistService } from "./checklist.service";
import type {
  AddRequirementDto,
  CreateRequirementDocumentDto,
  CreateSourcingProjectDto,
  PreviewChecklistDto,
  ProjectListQuery,
  ReassessRiskDto,
  UpdateProjectDto,
  UpdateRequirementAssignmentDto,
} from "./sourcing.dto";

const ACTIVE_STATUSES: SourcingProjectStatus[] = ["DRAFT", "SUBMITTED", "IN_PROGRESS", "QUALIFICATION", "ON_HOLD"];
const OWNERSHIP: Record<"A" | "B" | "C", DesignOwnership> = { A: "COMPANY", B: "SUPPLIER", C: "SHARED" };

const PROJECT_INCLUDE = {
  internalPart: { select: { id: true, partNumber: true, description: true, criticality: true, status: true } },
  supplier: { select: { id: true, name: true, supplierNumber: true, status: true, country: true } },
  site: { select: { id: true, siteCode: true, name: true, status: true, country: true } },
  supplierPart: { select: { id: true, supplierPartNumber: true, isCustom: true } },
  supplierProduct: { select: { id: true, status: true } },
  configuration: { select: { id: true, configCode: true, name: true, configurationType: true, baseConfigurationId: true, currentApprovedRevisionId: true, revisions: { orderBy: { revisionNumber: "desc" }, take: 1, select: { id: true, revisionLabel: true, status: true, baseline: { select: { status: true, baselineType: true } } } } } },
  owner: { select: { id: true, displayName: true, email: true } },
  members: { include: { user: { select: { id: true, displayName: true, email: true } } }, orderBy: { createdAt: "asc" } },
  policyVersion: { select: { id: true, version: true, policy: { select: { key: true, name: true } } } },
} satisfies Prisma.SourcingProjectInclude;

@Injectable()
export class SourcingService implements OnModuleInit, WorkflowSubjectHandler {
  readonly subjectType = "SOURCING_PROJECT" as const;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly numbering: NumberingService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationService,
    private readonly workflow: WorkflowService,
    private readonly checklist: ChecklistService,
    private readonly configurations: ConfigurationsService,
    private readonly documents: DocumentsService,
  ) {}

  onModuleInit(): void {
    this.workflow.registerHandler(this);
  }

  // ------------------------------------------------------------------ risk helpers

  private assessRisk(input: { criticality: string; supplierStatus: string; pathway: "A" | "B" | "C"; reverseEngineering: boolean; specialProcesses: boolean }, selections: Record<string, string>) {
    const userKeys = new Set(RISK_FACTORS.filter((f) => !f.derived).map((f) => f.key));
    const clean: RiskSelections = {};
    for (const [k, v] of Object.entries(selections)) if (userKeys.has(k)) clean[k] = String(v);
    clean.specialProcesses = String(input.specialProcesses);
    try {
      return computeRisk({ criticality: input.criticality as never, supplierStatus: input.supplierStatus as never, pathway: input.pathway, reverseEngineering: input.reverseEngineering }, clean);
    } catch (err) {
      if (err instanceof RiskModelError) throw new BusinessRuleError(err.message);
      throw err;
    }
  }

  /** Wizard step 7 preview: risk and document requirements for the given inputs (nothing is persisted). */
  async preview(actor: Actor, dto: PreviewChecklistDto) {
    const part = dto.internalPartId ? await this.db.client.internalPart.findUnique({ where: { id: dto.internalPartId } }) : null;
    const supplier = dto.supplierId ? await this.db.client.supplier.findUnique({ where: { id: dto.supplierId } }) : null;
    const criticality = part?.criticality ?? dto.criticality ?? "MEDIUM";
    const supplierStatus = supplier?.status ?? "PROSPECTIVE";
    const risk = this.assessRisk({ criticality, supplierStatus, pathway: dto.pathway, reverseEngineering: dto.reverseEngineeringRequired, specialProcesses: dto.specialProcesses }, dto.riskFactors);
    const ctx = this.checklist.buildContext({
      pathway: dto.pathway,
      riskLevel: risk.level,
      criticality,
      supplierStatus,
      engineeringOwnership: OWNERSHIP[dto.pathway],
      reverseEngineering: dto.reverseEngineeringRequired,
      specialProcesses: dto.specialProcesses,
      customerRequirements: dto.customerRequirements || dto.pathway === "C",
    });
    const policy = await this.checklist.activePolicy(this.db.client as unknown as Tx);
    const evaluated = evaluateApplicability(this.checklist.toRuleInputs(policy.rules), ctx).filter((e) => e.level !== "NOT_APPLICABLE");
    const types = await this.db.client.documentType.findMany({ where: { code: { in: evaluated.map((e) => e.documentTypeCode) } }, select: { id: true, code: true, name: true, acronym: true, category: true } });
    return {
      risk,
      context: ctx,
      policyVersion: policy.version,
      requirements: evaluated.map((e) => ({ ...e, documentType: types.find((t) => t.code === e.documentTypeCode) })),
    };
  }

  // ------------------------------------------------------------------ create (wizard)

  async create(actor: Actor, dto: CreateSourcingProjectDto) {
    if (!!dto.internalPartId === !!dto.newPart) throw new BusinessRuleError("Select an existing product or define a new one");
    if (!!dto.supplierId === !!dto.newSupplier) throw new BusinessRuleError("Select an existing supplier or create a prospective supplier");
    if (dto.newSupplier && !dto.newSite) throw new BusinessRuleError("A manufacturing site is required for a new supplier");
    if (!dto.siteId && !dto.newSite) throw new BusinessRuleError("Identify the manufacturing site");
    if (dto.reverseEngineeringRequired && dto.pathway !== "A") throw new BusinessRuleError("Reverse engineering applies to Pathway A (customer-controlled design started from a physical sample)");
    if (dto.supplierPartId && dto.newSupplierPart) throw new BusinessRuleError("Select an existing supplier part or define a new one, not both");

    return this.db.tx(
      async (tx, after) => {
        // Step 1: product
        const part = dto.internalPartId
          ? await tx.internalPart.findFirst({ where: { id: dto.internalPartId, archivedAt: null } })
          : await tx.internalPart.create({ data: { ...dto.newPart!, partNumber: dto.newPart!.partNumber.trim().toUpperCase(), designOwnership: OWNERSHIP[dto.pathway], createdById: actor.userId } });
        if (!part) throw new NotFoundError("Product");
        if (dto.newPart) await this.audit.record({ eventType: "product.created", entityType: "INTERNAL_PART", entityId: part.id, entityLabel: part.partNumber, metadata: { via: "sourcing-wizard" } }, tx);

        // Step 2: supplier and site
        let supplier = dto.supplierId ? await tx.supplier.findFirst({ where: { id: dto.supplierId, archivedAt: null } }) : null;
        if (dto.supplierId && !supplier) throw new NotFoundError("Supplier");
        if (!supplier) {
          const supplierNumber = await this.numbering.next(tx, "SUPPLIER");
          const org = await tx.organization.create({ data: { type: "SUPPLIER", name: dto.newSupplier!.name, code: supplierNumber } });
          supplier = await tx.supplier.create({
            data: { organizationId: org.id, supplierNumber, name: dto.newSupplier!.name, legalName: dto.newSupplier!.legalName ?? null, website: dto.newSupplier!.website ?? null, country: dto.newSupplier!.country.toUpperCase(), status: "PROSPECTIVE", statusChangedAt: new Date(), createdById: actor.userId },
          });
          await this.audit.record({ eventType: "supplier.created", entityType: "SUPPLIER", entityId: supplier.id, entityLabel: `${supplierNumber} ${supplier.name}`, metadata: { via: "sourcing-wizard" } }, tx);
        }
        if (supplier.status === "INACTIVE") throw new BusinessRuleError("The supplier is inactive");
        const site = dto.siteId
          ? await tx.supplierSite.findFirst({ where: { id: dto.siteId, supplierId: supplier.id, archivedAt: null } })
          : await tx.supplierSite.create({ data: { ...dto.newSite!, siteCode: dto.newSite!.siteCode.trim().toUpperCase(), country: dto.newSite!.country.toUpperCase(), supplierId: supplier.id } });
        if (!site) throw new BusinessRuleError("The manufacturing site must belong to the selected supplier");

        // Step 6: supplier part (Path A: the supplier builds to our part number unless specified)
        let supplierPart = dto.supplierPartId ? await tx.supplierPart.findFirst({ where: { id: dto.supplierPartId, supplierId: supplier.id, archivedAt: null } }) : null;
        if (dto.supplierPartId && !supplierPart) throw new BusinessRuleError("The supplier part must belong to the selected supplier");
        if (!supplierPart) {
          const pn = (dto.newSupplierPart?.supplierPartNumber ?? part.partNumber).trim().toUpperCase();
          supplierPart =
            (await tx.supplierPart.findUnique({ where: { supplierId_supplierPartNumber: { supplierId: supplier.id, supplierPartNumber: pn } } })) ??
            (await tx.supplierPart.create({
              data: { supplierId: supplier.id, supplierPartNumber: pn, description: dto.newSupplierPart?.description ?? part.description, supplierRevision: dto.newSupplierPart?.supplierRevision ?? null, designOwnership: OWNERSHIP[dto.pathway] === "COMPANY" ? "COMPANY" : "SUPPLIER" },
            }));
        }
        // Path C may assign a distinct supplier part number to the custom configuration.
        let purchasedPart = supplierPart;
        if (dto.pathway === "C" && dto.customPartNumber) {
          const cpn = dto.customPartNumber.trim().toUpperCase();
          purchasedPart =
            (await tx.supplierPart.findUnique({ where: { supplierId_supplierPartNumber: { supplierId: supplier.id, supplierPartNumber: cpn } } })) ??
            (await tx.supplierPart.create({ data: { supplierId: supplier.id, supplierPartNumber: cpn, description: `${supplierPart.description} (custom configuration)`, isCustom: true, designOwnership: "SHARED" } }));
        }
        await tx.partCrossReference.upsert({
          where: { internalPartId_supplierPartId: { internalPartId: part.id, supplierPartId: purchasedPart.id } },
          update: {},
          create: { internalPartId: part.id, supplierPartId: purchasedPart.id, type: purchasedPart.isCustom ? "CUSTOM_CONFIGURATION" : "EQUIVALENT", createdById: actor.userId },
        });
        const supplierProduct =
          (await tx.supplierProduct.findUnique({ where: { internalPartId_supplierPartId_siteId: { internalPartId: part.id, supplierPartId: purchasedPart.id, siteId: site.id } } })) ??
          (await tx.supplierProduct.create({ data: { internalPartId: part.id, supplierId: supplier.id, supplierPartId: purchasedPart.id, siteId: site.id } }));

        // Configurations: Path C keeps the original supplier configuration and a separate custom configuration (baseline + delta).
        const baselineData = { ...(dto.baseline ?? {}) };
        let targetConfigurationId: string;
        if (dto.pathway === "C") {
          const base = await this.configurations.createConfiguration(actor, { supplierProductId: supplierProduct.id, name: `${supplierPart.supplierPartNumber} supplier standard`, configurationType: "SUPPLIER_STANDARD", baseline: { ...baselineData, baselineType: "SUPPLIER_PRODUCT_BASELINE" } }, tx);
          const custom = await this.configurations.createConfiguration(
            actor,
            { supplierProductId: supplierProduct.id, name: `${dto.title}`.slice(0, 200), configurationType: "SUPPLIER_MODIFIED", baseConfigurationId: base.configuration.id, customPartNumber: dto.customPartNumber, baseline: { ...baselineData, baselineType: "SUPPLIER_BASELINE_WITH_DELTA" } },
            tx,
          );
          for (const [i, r] of (dto.deltaRequirements ?? []).entries()) {
            await tx.customerRequirement.create({ data: { ...r, code: r.code?.trim().toUpperCase() ?? `REQ-${String(i + 1).padStart(3, "0")}`, configurationRevisionId: custom.revision.id, isModification: r.isModification ?? true, sortOrder: r.sortOrder ?? i } });
          }
          targetConfigurationId = custom.configuration.id;
        } else {
          const created = await this.configurations.createConfiguration(
            actor,
            {
              supplierProductId: supplierProduct.id,
              name: dto.title.slice(0, 200),
              configurationType: dto.pathway === "A" ? "CUSTOMER_DESIGN" : "SUPPLIER_STANDARD",
              baseline: { ...baselineData, baselineType: dto.pathway === "A" ? (dto.reverseEngineeringRequired ? "PRELIMINARY_REVERSE_ENGINEERED" : "CUSTOMER_CONTROLLED_DESIGN") : "SUPPLIER_PRODUCT_BASELINE" },
            },
            tx,
          );
          targetConfigurationId = created.configuration.id;
        }

        // Step 5: risk assessment (server-computed)
        const risk = this.assessRisk({ criticality: part.criticality, supplierStatus: supplier.status, pathway: dto.pathway, reverseEngineering: dto.reverseEngineeringRequired, specialProcesses: dto.specialProcesses }, dto.riskFactors);

        // Project
        const ownerId = dto.ownerId ?? actor.userId;
        await this.assertInternalUsers(tx, [ownerId, ...(dto.members ?? []).map((m) => m.userId)]);
        const projectNumber = await this.numbering.next(tx, "SOURCING_PROJECT");
        const project = await tx.sourcingProject.create({
          data: {
            projectNumber,
            title: dto.title,
            description: dto.description ?? null,
            pathway: dto.pathway,
            reverseEngineeringRequired: dto.reverseEngineeringRequired,
            engineeringOwnership: OWNERSHIP[dto.pathway],
            internalPartId: part.id,
            supplierId: supplier.id,
            siteId: site.id,
            supplierPartId: purchasedPart.id,
            supplierProductId: supplierProduct.id,
            configurationId: targetConfigurationId,
            ownerId,
            targetDate: toDate(dto.targetDate) ?? null,
            businessJustification: dto.businessJustification,
            annualVolume: dto.annualVolume ?? null,
            specialProcesses: dto.specialProcesses,
            customerRequirements: dto.customerRequirements || dto.pathway === "C",
            createdById: actor.userId,
            members: {
              create: [
                { userId: ownerId, role: "OWNER" },
                ...(dto.members ?? []).filter((m) => !(m.userId === ownerId && m.role === "OWNER")).map((m) => ({ userId: m.userId, role: m.role, dueDate: toDate(m.dueDate) ?? null, responsibility: m.responsibility ?? null })),
              ],
            },
          },
          include: { members: true },
        });
        await tx.supplierProduct.update({ where: { id: supplierProduct.id }, data: { originProjectId: supplierProduct.originProjectId ?? project.id } });
        await tx.riskAssessment.create({
          data: {
            sourcingProjectId: project.id,
            internalPartId: part.id,
            modelVersion: risk.modelVersion,
            factors: risk.factors as unknown as Prisma.InputJsonValue,
            score: risk.score,
            level: risk.level,
            specialProcesses: dto.specialProcesses,
            specialProcessList: dto.specialProcessList ?? null,
            rationale: [dto.riskRationale, ...risk.overrides].filter(Boolean).join("\n") || null,
            assessedById: actor.userId,
          },
        });

        // Step 7: checklist from the versioned applicability policy.
        const ctx = this.checklist.buildContext({
          pathway: dto.pathway,
          riskLevel: risk.level,
          criticality: part.criticality,
          supplierStatus: supplier.status,
          engineeringOwnership: OWNERSHIP[dto.pathway],
          reverseEngineering: dto.reverseEngineeringRequired,
          specialProcesses: dto.specialProcesses,
          customerRequirements: project.customerRequirements,
        });
        const checklistResult = await this.checklist.generate(tx, project, ctx, actor.userId);

        // Native intake records: PSR (INT-01) and SPRA (INT-02) satisfy their checklist items.
        await this.createIntakeDocuments(tx, actor, project.id, {
          psr: {
            internalPartNumber: part.partNumber,
            partDescription: part.description,
            criticality: part.criticality,
            businessJustification: dto.businessJustification,
            annualVolume: dto.annualVolume ?? null,
            targetDate: dto.targetDate ?? null,
            supplierName: supplier.name,
            manufacturingSite: `${site.siteCode} ${site.name}`,
            supplierPartNumber: purchasedPart.supplierPartNumber,
            pathway: dto.pathway,
            reverseEngineering: dto.reverseEngineeringRequired,
            engineeringOwnership: OWNERSHIP[dto.pathway],
            technicalRequirements: dto.technicalRequirements ?? "",
            baselineInformation: dto.baselineInformation ?? "",
            specialProcesses: dto.specialProcesses,
            customerRequirements: project.customerRequirements,
            team: project.members.map((m) => ({ role: m.role, name: m.userId, dueDate: m.dueDate ? m.dueDate.toISOString().slice(0, 10) : null })),
          },
          spra: { modelVersion: risk.modelVersion, factors: risk.factors.map((f) => ({ factor: f.label, selection: f.valueLabel, points: f.points })), score: risk.score, level: risk.level, rationale: dto.riskRationale ?? "" },
        });

        await this.audit.record(
          { eventType: "sourcing_project.created", entityType: "SOURCING_PROJECT", entityId: project.id, entityLabel: `${projectNumber} ${project.title}`, metadata: { pathway: dto.pathway, riskLevel: risk.level, riskScore: risk.score, checklist: checklistResult } },
          tx,
        );
        await this.activity.record(tx, {
          entityType: "SOURCING_PROJECT",
          entityId: project.id,
          entityLabel: projectNumber,
          verb: "created",
          summary: `Sourcing project ${projectNumber} created: Pathway ${dto.pathway}${dto.reverseEngineeringRequired ? " (reverse engineering)" : ""}, risk ${risk.level} (${risk.score}); ${checklistResult.added} document requirements generated from policy v${checklistResult.policyVersion}`,
          supplierId: supplier.id,
          internalPartId: part.id,
          projectId: project.id,
        });
        await this.outbox.publish(tx, "sourcing_project.created", "SOURCING_PROJECT", project.id, { projectNumber, pathway: dto.pathway, internalPartId: part.id, supplierId: supplier.id });
        void after;
        return tx.sourcingProject.findUniqueOrThrow({ where: { id: project.id }, include: PROJECT_INCLUDE });
      },
      { timeoutMs: 60_000 },
    );
  }

  private async assertInternalUsers(tx: Tx, ids: string[]) {
    const unique = [...new Set(ids)];
    const count = await tx.user.count({ where: { id: { in: unique }, userType: "INTERNAL", status: "ACTIVE" } });
    if (count !== unique.length) throw new BusinessRuleError("Project members must be active internal users");
  }

  private async createIntakeDocuments(tx: Tx, actor: Actor, projectId: string, data: { psr: Record<string, unknown>; spra: Record<string, unknown> }) {
    const reqs = await tx.requiredDocument.findMany({ where: { projectId, documentType: { code: { in: ["INT-01", "INT-02"] } } }, include: { documentType: true } });
    const users = await tx.user.findMany({ where: { id: { in: ((data.psr.team as { name: string }[]) ?? []).map((t) => t.name) } }, select: { id: true, displayName: true } });
    data.psr.team = ((data.psr.team as { role: string; name: string; dueDate: string | null }[]) ?? []).map((t) => ({ ...t, name: users.find((u) => u.id === t.name)?.displayName ?? t.name }));
    const project = await tx.sourcingProject.findUniqueOrThrow({ where: { id: projectId } });
    for (const code of ["INT-01", "INT-02"] as const) {
      const type = await tx.documentType.findUniqueOrThrow({ where: { code } });
      const req = reqs.find((r) => r.documentType.code === code);
      await this.documents.create(
        actor,
        {
          documentTypeId: type.id,
          title: `${type.acronym} - ${project.projectNumber} ${project.title}`.slice(0, 300),
          submissionMethod: "NATIVE_FORM",
          supplierId: project.supplierId,
          formData: code === "INT-01" ? data.psr : data.spra,
          requiredDocumentId: req?.id,
          links: [{ entityType: "SOURCING_PROJECT", entityId: projectId, linkRole: "INTAKE" }],
        },
        tx,
      );
    }
  }

  private async intakeRevisions(tx: Tx, projectId: string) {
    return tx.documentRevision.findMany({
      where: { document: { links: { some: { entityType: "SOURCING_PROJECT", entityId: projectId, linkRole: "INTAKE" } }, documentType: { code: { in: ["INT-01", "INT-02"] } } } },
      include: { document: true },
      orderBy: { revisionNumber: "desc" },
    });
  }

  // ------------------------------------------------------------------ queries

  private listWhere(actor: Actor, q: ProjectListQuery): Prisma.SourcingProjectWhereInput {
    const scope = AccessScope.of(actor);
    const term = trimQ(q.q);
    return {
      archivedAt: null,
      ...(scope.isInternal ? {} : { supplierId: scope.supplierId ?? "__none__", supplierVisible: true }),
      ...(q.status?.length ? { status: { in: q.status as SourcingProjectStatus[] } } : {}),
      ...(q.active ? { status: { in: ACTIVE_STATUSES } } : {}),
      ...(q.pathway?.length ? { pathway: { in: q.pathway as ("A" | "B" | "C")[] } } : {}),
      ...(q.stage?.length ? { stage: { in: q.stage as ProjectStage[] } } : {}),
      ...(q.supplierId && scope.isInternal ? { supplierId: q.supplierId } : {}),
      ...(q.internalPartId ? { internalPartId: q.internalPartId } : {}),
      ...(q.ownerId ? { ownerId: q.ownerId } : {}),
      ...(q.siteId ? { siteId: q.siteId } : {}),
      ...(term ? { OR: [{ projectNumber: { contains: term } }, { title: { contains: term } }, { internalPart: { partNumber: { contains: term } } }, { supplier: { name: { contains: term } } }] } : {}),
    };
  }

  async list(actor: Actor, q: ProjectListQuery): Promise<Page<unknown>> {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where = this.listWhere(actor, q);
    const [total, rows] = await Promise.all([
      this.db.client.sourcingProject.count({ where }),
      this.db.client.sourcingProject.findMany({
        where,
        skip,
        take,
        orderBy: sortArg(q, ["projectNumber", "title", "status", "stage", "targetDate", "createdAt", "updatedAt"] as const, "updatedAt"),
        include: {
          internalPart: { select: { id: true, partNumber: true, description: true } },
          supplier: { select: { id: true, name: true } },
          owner: { select: { id: true, displayName: true } },
          riskAssessments: { where: { isCurrent: true }, select: { level: true, score: true } },
          requiredDocuments: { select: { status: true, level: true } },
        },
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: rows.map(({ requiredDocuments, riskAssessments, ...p }) => ({
        ...p,
        risk: riskAssessments[0] ?? null,
        checklist: this.summarize(requiredDocuments),
      })),
    };
  }

  summarize(reqs: { status: string; level: string }[]) {
    const active = reqs.filter((r) => r.status !== "NOT_APPLICABLE");
    const done = active.filter((r) => r.status === "ACCEPTED" || r.status === "WAIVED").length;
    return {
      total: active.length,
      completed: done,
      missing: active.filter((r) => r.status === "OPEN" || r.status === "REJECTED").length,
      pendingReview: active.filter((r) => r.status === "SUBMITTED").length,
      required: active.filter((r) => r.level === "REQUIRED").length,
      percent: active.length ? Math.round((done / active.length) * 100) : 0,
    };
  }

  async exportRows(actor: Actor, q: ProjectListQuery) {
    return this.db.client.sourcingProject.findMany({
      where: this.listWhere(actor, q),
      orderBy: { projectNumber: "asc" },
      take: 10_000,
      include: { internalPart: { select: { partNumber: true } }, supplier: { select: { name: true } }, owner: { select: { displayName: true } }, riskAssessments: { where: { isCurrent: true } }, requiredDocuments: { select: { status: true, level: true } } },
    });
  }

  async get(actor: Actor, id: string) {
    const scope = AccessScope.of(actor);
    const p = await this.db.client.sourcingProject.findFirst({ where: { id, archivedAt: null }, include: PROJECT_INCLUDE });
    if (!p || (!scope.isInternal && (!p.supplierVisible || p.supplierId !== scope.supplierId))) throw new NotFoundError("Sourcing project");
    const [requirements, risks, qualifications] = await Promise.all([
      this.requirements(id),
      this.db.client.riskAssessment.findMany({ where: { sourcingProjectId: id }, orderBy: { assessedAt: "desc" } }),
      this.db.client.productQualification.findMany({ where: { sourcingProjectId: id }, select: { id: true, number: true, status: true, riskLevel: true, createdAt: true } }),
    ]);
    return { ...p, requirements, checklist: this.summarize(requirements), risk: risks.find((r) => r.isCurrent) ?? null, riskHistory: risks, qualifications };
  }

  async requirements(projectId: string) {
    const reqs = await this.db.client.requiredDocument.findMany({
      where: { projectId },
      include: {
        documentType: { select: { id: true, code: true, name: true, acronym: true, category: true, nativeFormKey: true, nativeModule: true, allowUpload: true, supplierVisibility: true } },
        document: { select: { id: true, docNumber: true, title: true, status: true, latestRevision: { select: { id: true, revisionLabel: true, status: true } }, releasedRevision: { select: { id: true, revisionLabel: true } } } },
        acceptedRevision: { select: { id: true, revisionLabel: true } },
      },
    });
    const users = await this.db.client.user.findMany({ where: { id: { in: reqs.flatMap((r) => [r.assignedToId, r.waivedById].filter((x): x is string => !!x)) } }, select: { id: true, displayName: true } });
    return reqs
      .map((r) => ({ ...r, assignedTo: users.find((u) => u.id === r.assignedToId) ?? null, waivedBy: users.find((u) => u.id === r.waivedById) ?? null, overdue: !!r.dueDate && r.dueDate < new Date() && (r.status === "OPEN" || r.status === "REJECTED") }))
      .sort((a, b) => a.documentType.code.localeCompare(b.documentType.code));
  }

  // ------------------------------------------------------------------ edit, risk, lifecycle

  private async lockProject(tx: Tx, id: string, expectedVersion?: number) {
    await this.db.lockRow(tx, "sourcing_projects", id);
    const p = await tx.sourcingProject.findFirst({ where: { id, archivedAt: null }, include: { members: true, internalPart: true, supplier: true } });
    if (!p) throw new NotFoundError("Sourcing project");
    if (expectedVersion !== undefined && p.version !== expectedVersion) throw new StaleVersionError("Sourcing project");
    return p;
  }

  async update(actor: Actor, id: string, dto: UpdateProjectDto) {
    const { expectedVersion, targetDate, ...rest } = dto;
    return this.db.tx(async (tx) => {
      const before = await this.lockProject(tx, id, expectedVersion);
      if (["CLOSED", "CANCELLED", "REJECTED"].includes(before.status)) throw new InvalidTransitionError("Sourcing project", before.status, "edited");
      if (rest.ownerId) await this.assertInternalUsers(tx, [rest.ownerId]);
      const after = await tx.sourcingProject.update({ where: { id }, data: { ...rest, ...(targetDate !== undefined ? { targetDate: toDate(targetDate) } : {}), version: { increment: 1 } } });
      if (rest.ownerId && rest.ownerId !== before.ownerId) {
        await tx.sourcingProjectMember.upsert({ where: { projectId_userId_role: { projectId: id, userId: rest.ownerId, role: "OWNER" } }, update: {}, create: { projectId: id, userId: rest.ownerId, role: "OWNER" } });
        await tx.sourcingProjectMember.deleteMany({ where: { projectId: id, userId: before.ownerId, role: "OWNER" } });
      }
      const changes = diffControlled(before, after, ["title", "description", "businessJustification", "annualVolume", "targetDate", "ownerId", "stage", "supplierVisible"]);
      await this.audit.record({ eventType: "sourcing_project.updated", entityType: "SOURCING_PROJECT", entityId: id, entityLabel: before.projectNumber, changes }, tx);
      if (changes) await this.activity.record(tx, { entityType: "SOURCING_PROJECT", entityId: id, entityLabel: before.projectNumber, verb: "updated", summary: `Updated ${Object.keys(changes).join(", ")}`, projectId: id, supplierId: before.supplierId });
      return after;
    });
  }

  async addMember(actor: Actor, id: string, m: { userId: string; role: string; dueDate?: string; responsibility?: string }) {
    return this.db.tx(async (tx) => {
      const p = await this.lockProject(tx, id);
      await this.assertInternalUsers(tx, [m.userId]);
      const member = await tx.sourcingProjectMember.create({ data: { projectId: id, userId: m.userId, role: m.role as never, dueDate: toDate(m.dueDate) ?? null, responsibility: m.responsibility ?? null } });
      await this.audit.record({ eventType: "sourcing_project.member_added", entityType: "SOURCING_PROJECT", entityId: id, entityLabel: p.projectNumber, metadata: { userId: m.userId, role: m.role, dueDate: m.dueDate } }, tx);
      return member;
    });
  }

  async removeMember(actor: Actor, id: string, memberId: string) {
    return this.db.tx(async (tx) => {
      const p = await this.lockProject(tx, id);
      const m = await tx.sourcingProjectMember.findFirst({ where: { id: memberId, projectId: id } });
      if (!m) throw new NotFoundError("Project member");
      if (m.role === "OWNER") throw new BusinessRuleError("Change the project owner instead of removing the owner");
      await tx.sourcingProjectMember.delete({ where: { id: memberId } });
      await this.audit.record({ eventType: "sourcing_project.member_removed", entityType: "SOURCING_PROJECT", entityId: id, entityLabel: p.projectNumber, metadata: { userId: m.userId, role: m.role } }, tx);
    });
  }

  /** Re-assesses risk (new assessment record) and regenerates the checklist against the active policy. */
  async reassessRisk(actor: Actor, id: string, dto: ReassessRiskDto) {
    return this.db.tx(async (tx) => {
      const p = await this.lockProject(tx, id, dto.expectedVersion);
      if (!["DRAFT", "IN_PROGRESS", "ON_HOLD"].includes(p.status)) throw new InvalidTransitionError("Sourcing project", p.status, "re-assessed");
      const specialProcesses = dto.specialProcesses ?? p.specialProcesses;
      const customerRequirements = dto.customerRequirements ?? p.customerRequirements;
      const risk = this.assessRisk({ criticality: p.internalPart.criticality, supplierStatus: p.supplier.status, pathway: p.pathway, reverseEngineering: p.reverseEngineeringRequired, specialProcesses }, dto.riskFactors);
      const previous = await tx.riskAssessment.findFirst({ where: { sourcingProjectId: id, isCurrent: true } });
      await tx.riskAssessment.updateMany({ where: { sourcingProjectId: id, isCurrent: true }, data: { isCurrent: false } });
      await tx.riskAssessment.create({
        data: { sourcingProjectId: id, internalPartId: p.internalPartId, modelVersion: risk.modelVersion, factors: risk.factors as unknown as Prisma.InputJsonValue, score: risk.score, level: risk.level, specialProcesses, rationale: dto.rationale, assessedById: actor.userId },
      });
      await tx.sourcingProject.update({ where: { id }, data: { specialProcesses, customerRequirements, version: { increment: 1 } } });
      const ctx = this.checklist.buildContext({ pathway: p.pathway, riskLevel: risk.level, criticality: p.internalPart.criticality, supplierStatus: p.supplier.status, engineeringOwnership: p.engineeringOwnership, reverseEngineering: p.reverseEngineeringRequired, specialProcesses, customerRequirements });
      const result = await this.checklist.generate(tx, { ...p, specialProcesses, customerRequirements }, ctx, actor.userId);
      await this.audit.record({ eventType: "risk.reassessed", entityType: "SOURCING_PROJECT", entityId: id, entityLabel: p.projectNumber, changes: { riskLevel: { before: previous?.level ?? null, after: risk.level }, riskScore: { before: previous?.score ?? null, after: risk.score } }, reason: dto.rationale }, tx);
      await this.activity.record(tx, { entityType: "SOURCING_PROJECT", entityId: id, entityLabel: p.projectNumber, verb: "risk_reassessed", summary: `Risk re-assessed: ${previous?.level ?? "-"} → ${risk.level} (${risk.score}); checklist +${result.added}, updated ${result.updated}, not applicable ${result.notApplicable}`, projectId: id, supplierId: p.supplierId });
      return { risk, checklist: result };
    });
  }

  /** Step 9: submit the project (PSR + SPRA) for intake review. */
  async submit(actor: Actor, id: string, expectedVersion: number) {
    return this.db.tx(async (tx, after) => {
      const p = await this.lockProject(tx, id, expectedVersion);
      if (p.status !== "DRAFT") throw new InvalidTransitionError("Sourcing project", p.status, "submitted");
      const intake = await this.intakeRevisions(tx, id);
      const latestByDoc = new Map<string, (typeof intake)[number]>();
      for (const r of intake) if (!latestByDoc.has(r.documentId)) latestByDoc.set(r.documentId, r);
      if (latestByDoc.size < 2) throw new BusinessRuleError("The Product Sourcing Request and Sourcing Path & Risk Assessment records are missing");
      const hashes: string[] = [];
      for (const r of latestByDoc.values()) {
        if (r.status !== "DRAFT") continue;
        const hash = createHash("sha256").update(canonicalJson({ title: r.document.title, formData: r.formData, files: [] })).digest("hex");
        hashes.push(hash);
        await tx.documentRevision.update({ where: { id: r.id }, data: { status: "IN_REVIEW", contentHash: hash, submittedAt: new Date(), submittedById: actor.userId, version: { increment: 1 } } });
        await tx.documentRecord.update({ where: { id: r.documentId }, data: { status: "IN_REVIEW", version: { increment: 1 } } });
        await this.documents.syncRequirements(tx, r.documentId, r.id, "SUBMITTED");
      }
      await tx.sourcingProject.update({ where: { id }, data: { status: "SUBMITTED", submittedAt: new Date(), submittedById: actor.userId, version: { increment: 1 } } });
      const risk = await tx.riskAssessment.findFirst({ where: { sourcingProjectId: id, isCurrent: true } });
      const instance = await this.workflow.start(tx, after, {
        definitionKey: "sourcing-project-review",
        subjectType: "SOURCING_PROJECT",
        subjectId: id,
        subjectLabel: `${p.projectNumber} ${p.title}`,
        subjectVersionRef: createHash("sha256").update(hashes.sort().join(":")).digest("hex"),
        link: `/projects/${id}`,
        context: { riskLevel: risk?.level, pathway: p.pathway, ownerUserId: p.ownerId },
        startedById: actor.userId,
      });
      await tx.sourcingProject.update({ where: { id }, data: { workflowInstanceId: instance.id } });
      await this.audit.record({ eventType: "sourcing_project.submitted", entityType: "SOURCING_PROJECT", entityId: id, entityLabel: p.projectNumber }, tx);
      await this.activity.record(tx, { entityType: "SOURCING_PROJECT", entityId: id, entityLabel: p.projectNumber, verb: "submitted", summary: "Submitted for intake review (PSR and SPRA)", projectId: id, supplierId: p.supplierId });
      return tx.sourcingProject.findUniqueOrThrow({ where: { id } });
    });
  }

  private initialStage(p: { reverseEngineeringRequired: boolean; supplier: { status: string } }): ProjectStage {
    if (p.reverseEngineeringRequired) return "REVERSE_ENGINEERING";
    if (!["APPROVED", "CONDITIONALLY_APPROVED"].includes(p.supplier.status)) return "SUPPLIER_ONBOARDING";
    return "ENGINEERING_DEFINITION";
  }

  async onApproved(tx: Tx, after: AfterCommit, instance: WorkflowInstance): Promise<void> {
    const p = await tx.sourcingProject.findUniqueOrThrow({ where: { id: instance.subjectId }, include: { supplier: true, members: true } });
    for (const r of await this.intakeRevisions(tx, p.id)) {
      if (r.status !== "IN_REVIEW") continue;
      await tx.documentRevision.update({ where: { id: r.id }, data: { status: "APPROVED", approvedAt: new Date(), version: { increment: 1 } } });
      await tx.documentRecord.update({ where: { id: r.documentId }, data: { status: "APPROVED", version: { increment: 1 } } });
      await this.documents.syncRequirements(tx, r.documentId, r.id, "ACCEPTED");
    }
    const stage = this.initialStage(p);
    await tx.sourcingProject.update({ where: { id: p.id }, data: { status: "IN_PROGRESS", stage, version: { increment: 1 } } });
    // Create submission tasks for open requirements.
    const open = await tx.requiredDocument.findMany({ where: { projectId: p.id, status: "OPEN" }, include: { documentType: true } });
    for (const r of open) {
      await tx.task.create({
        data: {
          title: `Provide ${r.documentType.code} ${r.documentType.name} for ${p.projectNumber}`.slice(0, 300),
          type: "DOCUMENT_SUBMISSION",
          assigneeUserId: r.assignedToId,
          assigneeRoleKey: r.assignedToId ? null : r.assignedRoleKey,
          dueAt: r.dueDate,
          entityType: "SOURCING_PROJECT",
          entityId: p.id,
          entityLabel: p.projectNumber,
          requiredDocumentId: r.id,
          priority: r.level === "REQUIRED" ? "HIGH" : "NORMAL",
          createdById: p.ownerId,
        },
      });
    }
    await this.activity.record(tx, { entityType: "SOURCING_PROJECT", entityId: p.id, entityLabel: p.projectNumber, verb: "intake_approved", summary: `Intake approved; project in progress (stage ${stage}); ${open.length} document tasks created`, projectId: p.id, supplierId: p.supplierId });
    await this.notifications.notify(tx, after, { eventType: "project.intake_approved", title: `Sourcing project ${p.projectNumber} approved to proceed`, entityType: "SOURCING_PROJECT", entityId: p.id, link: `/projects/${p.id}`, userIds: p.members.map((m) => m.userId) });
    await this.outbox.publish(tx, "sourcing_project.intake_approved", "SOURCING_PROJECT", p.id, { projectNumber: p.projectNumber });
  }

  async onRejected(tx: Tx, _after: AfterCommit, instance: WorkflowInstance, comment: string): Promise<void> {
    const p = await tx.sourcingProject.findUniqueOrThrow({ where: { id: instance.subjectId } });
    for (const r of await this.intakeRevisions(tx, p.id)) {
      if (r.status !== "IN_REVIEW") continue;
      await tx.documentRevision.update({ where: { id: r.id }, data: { status: "REJECTED", rejectedAt: new Date(), rejectionReason: comment, version: { increment: 1 } } });
      await tx.documentRecord.update({ where: { id: r.documentId }, data: { status: "REJECTED", version: { increment: 1 } } });
      await this.documents.syncRequirements(tx, r.documentId, r.id, "REJECTED");
    }
    await tx.sourcingProject.update({ where: { id: p.id }, data: { status: "REJECTED", version: { increment: 1 } } });
    await this.activity.record(tx, { entityType: "SOURCING_PROJECT", entityId: p.id, entityLabel: p.projectNumber, verb: "intake_rejected", summary: `Intake rejected: ${comment}`, projectId: p.id, supplierId: p.supplierId });
  }

  async onInfoRequested(tx: Tx, _after: AfterCommit, instance: WorkflowInstance, comment: string): Promise<void> {
    const p = await tx.sourcingProject.findUniqueOrThrow({ where: { id: instance.subjectId } });
    for (const r of await this.intakeRevisions(tx, p.id)) {
      if (r.status !== "IN_REVIEW") continue;
      await tx.documentRevision.update({ where: { id: r.id }, data: { status: "DRAFT", contentHash: null, version: { increment: 1 } } });
      await tx.documentRecord.update({ where: { id: r.documentId }, data: { status: "DRAFT", version: { increment: 1 } } });
      await this.documents.syncRequirements(tx, r.documentId, r.id, "OPEN");
    }
    await tx.sourcingProject.update({ where: { id: p.id }, data: { status: "DRAFT", version: { increment: 1 } } });
    await this.activity.record(tx, { entityType: "SOURCING_PROJECT", entityId: p.id, entityLabel: p.projectNumber, verb: "intake_returned", summary: `Returned for more information: ${comment}`, projectId: p.id, supplierId: p.supplierId });
  }

  async hold(actor: Actor, id: string, expectedVersion: number, reason: string) {
    return this.db.tx(async (tx) => {
      const p = await this.lockProject(tx, id, expectedVersion);
      if (!["IN_PROGRESS", "QUALIFICATION", "DRAFT"].includes(p.status)) throw new InvalidTransitionError("Sourcing project", p.status, "put on hold");
      await tx.sourcingProject.update({ where: { id }, data: { status: "ON_HOLD", holdReason: reason, version: { increment: 1 } } });
      await this.audit.record({ eventType: "sourcing_project.on_hold", entityType: "SOURCING_PROJECT", entityId: id, entityLabel: p.projectNumber, changes: { status: { before: p.status, after: "ON_HOLD" } }, reason, metadata: { resumeStatus: p.status } }, tx);
    });
  }

  async resume(actor: Actor, id: string, expectedVersion: number) {
    return this.db.tx(async (tx) => {
      const p = await this.lockProject(tx, id, expectedVersion);
      if (p.status !== "ON_HOLD") throw new InvalidTransitionError("Sourcing project", p.status, "resumed");
      const holdEvent = await tx.auditEvent.findFirst({ where: { entityId: id, eventType: "sourcing_project.on_hold" }, orderBy: { occurredAt: "desc" } });
      const resumeStatus = ((holdEvent?.metadata as { resumeStatus?: SourcingProjectStatus } | null)?.resumeStatus ?? "IN_PROGRESS") as SourcingProjectStatus;
      await tx.sourcingProject.update({ where: { id }, data: { status: resumeStatus, holdReason: null, version: { increment: 1 } } });
      await this.audit.record({ eventType: "sourcing_project.resumed", entityType: "SOURCING_PROJECT", entityId: id, entityLabel: p.projectNumber, changes: { status: { before: "ON_HOLD", after: resumeStatus } } }, tx);
    });
  }

  async cancel(actor: Actor, id: string, expectedVersion: number, reason: string) {
    return this.db.tx(async (tx) => {
      const p = await this.lockProject(tx, id, expectedVersion);
      if (["CLOSED", "CANCELLED", "APPROVED"].includes(p.status)) throw new InvalidTransitionError("Sourcing project", p.status, "cancelled");
      await this.workflow.cancelForSubject(tx, "SOURCING_PROJECT", id, reason);
      await tx.sourcingProject.update({ where: { id }, data: { status: "CANCELLED", closedAt: new Date(), version: { increment: 1 } } });
      await tx.task.updateMany({ where: { entityType: "SOURCING_PROJECT", entityId: id, status: { in: ["OPEN", "IN_PROGRESS"] } }, data: { status: "CANCELLED" } });
      await this.audit.record({ eventType: "sourcing_project.cancelled", entityType: "SOURCING_PROJECT", entityId: id, entityLabel: p.projectNumber, changes: { status: { before: p.status, after: "CANCELLED" } }, reason }, tx);
    });
  }

  async close(actor: Actor, id: string, expectedVersion: number) {
    return this.db.tx(async (tx) => {
      const p = await this.lockProject(tx, id, expectedVersion);
      if (p.status !== "APPROVED") throw new InvalidTransitionError("Sourcing project", p.status, "closed");
      await tx.sourcingProject.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date(), version: { increment: 1 } } });
      await this.audit.record({ eventType: "sourcing_project.closed", entityType: "SOURCING_PROJECT", entityId: id, entityLabel: p.projectNumber, changes: { status: { before: "APPROVED", after: "CLOSED" } } }, tx);
    });
  }

  // ------------------------------------------------------------------ requirement actions

  private async loadRequirement(tx: Tx, id: string) {
    const r = await tx.requiredDocument.findUnique({ where: { id }, include: { documentType: true, project: true } });
    if (!r) throw new NotFoundError("Required document");
    return r;
  }

  async addRequirement(actor: Actor, projectId: string, dto: AddRequirementDto) {
    return this.db.tx(async (tx) => {
      const p = await this.lockProject(tx, projectId);
      if (["CLOSED", "CANCELLED", "REJECTED", "APPROVED"].includes(p.status)) throw new InvalidTransitionError("Sourcing project", p.status, "changed");
      const type = await tx.documentType.findUnique({ where: { id: dto.documentTypeId } });
      if (!type || type.status !== "ACTIVE") throw new BusinessRuleError("The document type is not active");
      if (dto.assignedToId) await this.assertInternalUsers(tx, [dto.assignedToId]);
      const req = await tx.requiredDocument.create({
        data: { projectId, documentTypeId: type.id, level: dto.level, status: "OPEN", source: "MANUAL", reason: dto.reason, dueDate: toDate(dto.dueDate) ?? null, assignedToId: dto.assignedToId ?? null, addedById: actor.userId },
      });
      await this.audit.record({ eventType: "requirement.added", entityType: "REQUIRED_DOCUMENT", entityId: req.id, entityLabel: `${p.projectNumber} ${type.code}`, reason: dto.reason, metadata: { projectId, level: dto.level } }, tx);
      await this.activity.record(tx, { entityType: "SOURCING_PROJECT", entityId: projectId, entityLabel: p.projectNumber, verb: "requirement_added", summary: `Added ${dto.level.toLowerCase()} requirement ${type.code} ${type.name}: ${dto.reason}`, projectId, supplierId: p.supplierId });
      return req;
    });
  }

  async updateRequirement(actor: Actor, id: string, dto: UpdateRequirementAssignmentDto) {
    return this.db.tx(async (tx) => {
      const r = await this.loadRequirement(tx, id);
      if (dto.assignedToId) await this.assertInternalUsers(tx, [dto.assignedToId]);
      const after = await tx.requiredDocument.update({ where: { id }, data: { ...dto, ...(dto.dueDate !== undefined ? { dueDate: toDate(dto.dueDate) } : {}), ...(dto.assignedToId ? { assignedRoleKey: null } : {}), version: { increment: 1 } } });
      await tx.task.updateMany({ where: { requiredDocumentId: id, status: { in: ["OPEN", "IN_PROGRESS"] } }, data: { ...(dto.assignedToId !== undefined ? { assigneeUserId: dto.assignedToId, assigneeRoleKey: dto.assignedToId ? null : r.assignedRoleKey } : {}), ...(dto.dueDate !== undefined ? { dueAt: toDate(dto.dueDate) } : {}) } });
      await this.audit.record({ eventType: "requirement.updated", entityType: "REQUIRED_DOCUMENT", entityId: id, entityLabel: `${r.project?.projectNumber ?? ""} ${r.documentType.code}`, changes: diffControlled(r, after, ["assignedToId", "dueDate", "notes"]) }, tx);
      return after;
    });
  }

  /**
   * Waives a requirement with documented justification. Conditional requirements need project:waive_conditional;
   * mandatory (REQUIRED) controls need project:waive_mandatory.
   */
  async waive(actor: Actor, id: string, justification: string) {
    const assertAuthority = async (r: { level: string; documentType: { code: string } }) => {
      const needed = r.level === "REQUIRED" ? "project:waive_mandatory" : "project:waive_conditional";
      if (actor.permissions.has(needed)) return;
      // Recorded outside any transaction so the denial survives the rejected request.
      await this.audit.record({ eventType: "requirement.waive_denied", outcome: "DENIED", entityType: "REQUIRED_DOCUMENT", entityId: id, entityLabel: r.documentType.code, metadata: { level: r.level, missingPermission: needed } });
      throw new ForbiddenError(r.level === "REQUIRED" ? "Waiving a mandatory control requires the project:waive_mandatory permission" : "Waiving a conditional requirement requires the project:waive_conditional permission");
    };
    await assertAuthority(await this.loadRequirement(this.db.client as unknown as Tx, id));
    let deniedLevel: { level: string; documentType: { code: string } } | null = null;
    const result = await this.db.tx(async (tx) => {
      await this.db.lockRow(tx, "required_documents", id);
      const r = await this.loadRequirement(tx, id);
      // The level may have been raised by a concurrent checklist regeneration.
      if (r.level === "REQUIRED" && !actor.permissions.has("project:waive_mandatory")) {
        deniedLevel = r;
        return null;
      }
      if (!["OPEN", "REJECTED", "SUBMITTED"].includes(r.status)) throw new InvalidTransitionError("Requirement", r.status, "waived");
      const after = await tx.requiredDocument.update({ where: { id }, data: { status: "WAIVED", waivedById: actor.userId, waivedAt: new Date(), waiverJustification: justification, version: { increment: 1 } } });
      await tx.task.updateMany({ where: { requiredDocumentId: id, status: { in: ["OPEN", "IN_PROGRESS"] } }, data: { status: "CANCELLED" } });
      await this.audit.record({ eventType: "requirement.waived", entityType: "REQUIRED_DOCUMENT", entityId: id, entityLabel: `${r.project?.projectNumber ?? ""} ${r.documentType.code}`, changes: { status: { before: r.status, after: "WAIVED" } }, reason: justification, metadata: { level: r.level } }, tx);
      if (r.projectId) await this.activity.record(tx, { entityType: "SOURCING_PROJECT", entityId: r.projectId, entityLabel: r.project?.projectNumber, verb: "requirement_waived", summary: `${r.level} requirement ${r.documentType.code} waived: ${justification}`, projectId: r.projectId, supplierId: r.project?.supplierId });
      return after;
    });
    if (deniedLevel) await assertAuthority(deniedLevel);
    return result;
  }

  async reinstate(actor: Actor, id: string) {
    return this.db.tx(async (tx) => {
      const r = await this.loadRequirement(tx, id);
      if (r.status !== "WAIVED" && r.status !== "NOT_APPLICABLE") throw new InvalidTransitionError("Requirement", r.status, "reinstated");
      const after = await tx.requiredDocument.update({ where: { id }, data: { status: "OPEN", waivedAt: null, waivedById: null, waiverJustification: null, version: { increment: 1 } } });
      await this.audit.record({ eventType: "requirement.reinstated", entityType: "REQUIRED_DOCUMENT", entityId: id, entityLabel: r.documentType.code, changes: { status: { before: r.status, after: "OPEN" } } }, tx);
      return after;
    });
  }

  async linkDocument(actor: Actor, id: string, documentId: string) {
    return this.db.tx(async (tx) => {
      const r = await this.loadRequirement(tx, id);
      const { doc } = await this.documents.loadForActor(actor, documentId, tx);
      await this.documents.attachToRequirement(tx, actor, id, doc.id, doc.documentTypeId);
      const latest = await tx.documentRevision.findFirst({ where: { documentId }, orderBy: { revisionNumber: "desc" } });
      const accepted = doc.releasedRevisionId ?? (latest?.status === "APPROVED" ? latest.id : null);
      if (accepted) await tx.requiredDocument.update({ where: { id }, data: { status: "ACCEPTED", acceptedRevisionId: accepted, acceptedAt: new Date() } });
      else if (latest?.status === "IN_REVIEW") await tx.requiredDocument.update({ where: { id }, data: { status: "SUBMITTED" } });
      if (r.projectId) await this.activity.record(tx, { entityType: "SOURCING_PROJECT", entityId: r.projectId, entityLabel: r.project?.projectNumber, verb: "requirement_linked", summary: `${doc.docNumber} linked to requirement ${r.documentType.code}`, projectId: r.projectId, supplierId: r.project?.supplierId });
      return tx.requiredDocument.findUniqueOrThrow({ where: { id } });
    });
  }

  async createDocument(actor: Actor, id: string, dto: CreateRequirementDocumentDto) {
    const r = await this.db.client.requiredDocument.findUnique({
      where: { id },
      include: { project: true, changeRequest: true, qualification: { include: { supplierProduct: { select: { internalPartId: true } } } } },
    });
    if (!r) throw new NotFoundError("Required document");
    // The owning record determines the supplier and the reference links (never the client).
    const owner = r.project
      ? { supplierId: r.project.supplierId, internalPartId: r.project.internalPartId, extra: [] as { entityType: "CHANGE_REQUEST" | "PRODUCT_QUALIFICATION"; entityId: string }[] }
      : r.changeRequest
        ? { supplierId: r.changeRequest.supplierId, internalPartId: r.changeRequest.internalPartId, extra: [{ entityType: "CHANGE_REQUEST" as const, entityId: r.changeRequest.id }] }
        : r.qualification
          ? { supplierId: r.qualification.supplierId, internalPartId: r.qualification.supplierProduct.internalPartId, extra: [{ entityType: "PRODUCT_QUALIFICATION" as const, entityId: r.qualification.id }] }
          : null;
    if (!owner) throw new BusinessRuleError("The requirement is not attached to a project, change request or qualification");
    AccessScope.of(actor).assertSupplier(owner.supplierId, "Required document");
    return this.documents.create(actor, {
      documentTypeId: r.documentTypeId,
      title: dto.title,
      submissionMethod: dto.submissionMethod,
      formData: dto.formData,
      supplierId: owner.supplierId,
      requiredDocumentId: id,
      links: [
        { entityType: "SUPPLIER", entityId: owner.supplierId, linkRole: "REFERENCE" },
        { entityType: "INTERNAL_PART", entityId: owner.internalPartId, linkRole: "REFERENCE" },
        ...owner.extra.map((e) => ({ ...e, linkRole: "EVIDENCE" })),
      ],
    });
  }

  /** Current risk level of a project (used by qualifications). */
  async currentRisk(tx: Tx, projectId: string): Promise<RiskLevel | null> {
    return (await tx.riskAssessment.findFirst({ where: { sourcingProjectId: projectId, isCurrent: true } }))?.level ?? null;
  }
}
