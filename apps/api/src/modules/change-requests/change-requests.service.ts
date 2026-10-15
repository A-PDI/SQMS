import { createHash } from "node:crypto";
import { Injectable, OnModuleInit } from "@nestjs/common";
import type { ChangeCategory, ChangeRequestStatus, Prisma, RiskLevel, WorkflowInstance } from "@sqms/db";
import { canonicalJson, CHANGE_VALIDATION_DOCUMENTS } from "@sqms/shared";
import type { Actor } from "../../common/auth/actor";
import { AccessScope } from "../../common/auth/access-scope";
import { ActivityService } from "../../common/audit/activity.service";
import { AuditService, diffControlled } from "../../common/audit/audit.service";
import { RequestContext } from "../../common/context/request-context";
import { DbService, type AfterCommit, type Tx } from "../../common/db/db.service";
import { ApprovalGateError, BusinessRuleError, ConflictError, ForbiddenError, InvalidTransitionError, NotFoundError, StaleVersionError } from "../../common/errors/app-errors";
import { toDate } from "../../common/http/dto-helpers";
import { pageArgs, sortArg, trimQ, type Page } from "../../common/http/pagination";
import { NotificationService } from "../../common/services/notification.service";
import { NumberingService } from "../../common/services/numbering.service";
import { OutboxService } from "../../common/services/outbox.service";
import { ConfigurationsService } from "../configurations/configurations.service";
import { QualificationsService } from "../qualifications/qualifications.service";
import { WorkflowService, type WorkflowSubjectHandler } from "../workflow/workflow.service";
import type { ChangeRequestListQuery, CreateChangeRequestDto, ImpactAssessmentDto, RequalificationDecisionDto, UpdateChangeRequestDto } from "./change-requests.dto";

const OPEN_STATUSES: ChangeRequestStatus[] = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "INFO_REQUIRED", "VALIDATION_REQUIRED"];
const REVIEW_STATUSES: ChangeRequestStatus[] = ["SUBMITTED", "UNDER_REVIEW", "VALIDATION_REQUIRED"];
const EDITABLE_STATUSES: ChangeRequestStatus[] = ["DRAFT", "INFO_REQUIRED"];

/** Engineering baseline fields compared between the authorized and proposed configuration. */
const BASELINE_FIELDS = [
  "baselineType", "designOwnership", "drawingNumber", "drawingRevision", "specificationNumber", "specificationRevision", "material", "materialSpecification", "coating",
  "heatTreatment", "performanceRequirements", "guaranteedCharacteristics", "reverseEngineeringSource", "notes",
] as const;

const REVISION_INCLUDE = {
  configuration: { select: { id: true, configCode: true, name: true, configurationType: true, supplierProductId: true, currentApprovedRevisionId: true } },
  baseline: true,
  requirements: { orderBy: { code: "asc" } },
  characteristics: { orderBy: { charNumber: "asc" } },
} satisfies Prisma.ConfigurationRevisionInclude;

type RevisionWithDefinition = Prisma.ConfigurationRevisionGetPayload<{ include: typeof REVISION_INCLUDE }>;

@Injectable()
export class ChangeRequestsService implements OnModuleInit, WorkflowSubjectHandler {
  readonly subjectType = "CHANGE_REQUEST" as const;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly numbering: NumberingService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationService,
    private readonly workflow: WorkflowService,
    private readonly configurations: ConfigurationsService,
    private readonly qualifications: QualificationsService,
  ) {}

  onModuleInit(): void {
    this.workflow.registerHandler(this);
  }

  // ------------------------------------------------------------------ queries

  private listWhere(actor: Actor, q: ChangeRequestListQuery): Prisma.ChangeRequestWhereInput {
    const scope = AccessScope.of(actor);
    const term = trimQ(q.q);
    return {
      ...(scope.isInternal ? {} : { ...scope.supplierWhere(), supplierVisible: true }),
      ...(q.status?.length ? { status: { in: q.status as ChangeRequestStatus[] } } : {}),
      ...(q.category?.length ? { categories: { some: { category: { in: q.category as ChangeCategory[] } } } } : {}),
      ...(q.supplierId && scope.isInternal ? { supplierId: q.supplierId } : {}),
      ...(q.internalPartId ? { internalPartId: q.internalPartId } : {}),
      ...(q.supplierProductId ? { supplierProductId: q.supplierProductId } : {}),
      ...(term ? { OR: [{ number: { contains: term } }, { title: { contains: term } }, { internalPart: { partNumber: { contains: term } } }] } : {}),
    };
  }

  async list(actor: Actor, q: ChangeRequestListQuery): Promise<Page<unknown>> {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where = this.listWhere(actor, q);
    const [total, items] = await Promise.all([
      this.db.client.changeRequest.count({ where }),
      this.db.client.changeRequest.findMany({
        where,
        skip,
        take,
        orderBy: sortArg(q, ["number", "title", "status", "createdAt", "updatedAt", "proposedImplementationDate"] as const, "updatedAt"),
        include: {
          supplier: { select: { id: true, name: true, supplierNumber: true } },
          internalPart: { select: { id: true, partNumber: true, description: true } },
          supplierPart: { select: { id: true, supplierPartNumber: true } },
          currentSite: { select: { id: true, siteCode: true, name: true } },
          proposedSite: { select: { id: true, siteCode: true, name: true } },
          categories: true,
        },
      }),
    ]);
    return { total, page, pageSize, items: items.map(({ categories, ...c }) => ({ ...c, categories: categories.map((x) => x.category) })) };
  }

  async exportRows(actor: Actor, q: ChangeRequestListQuery) {
    return this.db.client.changeRequest.findMany({
      where: this.listWhere(actor, q),
      orderBy: { number: "asc" },
      take: 10_000,
      include: { supplier: { select: { name: true } }, internalPart: { select: { partNumber: true } }, currentSite: { select: { siteCode: true } }, proposedSite: { select: { siteCode: true } }, categories: true },
    });
  }

  /** Field-level comparison of the authorized configuration and the proposed one (kept as distinct revisions). */
  compareRevisions(current: RevisionWithDefinition, proposed: RevisionWithDefinition | null) {
    if (!proposed) return null;
    const baseline: { field: string; current: unknown; proposed: unknown }[] = [];
    for (const f of BASELINE_FIELDS) {
      const a = (current.baseline as Record<string, unknown> | null)?.[f] ?? null;
      const b = (proposed.baseline as Record<string, unknown> | null)?.[f] ?? null;
      if (a !== b) baseline.push({ field: f, current: a, proposed: b });
    }
    const key = (r: { code: string }) => r.code;
    const cur = new Map(current.requirements.map((r) => [key(r), r]));
    const prop = new Map(proposed.requirements.map((r) => [key(r), r]));
    const requirements = {
      added: proposed.requirements.filter((r) => !cur.has(key(r))).map((r) => ({ code: r.code, title: r.title, requiredValue: r.requiredValue })),
      removed: current.requirements.filter((r) => !prop.has(key(r))).map((r) => ({ code: r.code, title: r.title })),
      changed: proposed.requirements
        .filter((r) => cur.has(key(r)))
        .map((r) => {
          const c = cur.get(key(r))!;
          const fields = (["category", "title", "baselineValue", "requiredValue", "acceptanceCriteria"] as const).filter((f) => c[f] !== r[f]).map((f) => ({ field: f, current: c[f], proposed: r[f] }));
          return { code: r.code, fields };
        })
        .filter((r) => r.fields.length > 0),
    };
    const cc = new Map(current.characteristics.map((c) => [c.charNumber, c]));
    const characteristics = proposed.characteristics
      .map((c) => {
        const before = cc.get(c.charNumber);
        if (!before) return { charNumber: c.charNumber, name: c.name, change: "added" };
        const changed = (["name", "classification", "unit"] as const).some((f) => before[f] !== c[f]) || String(before.nominal) !== String(c.nominal) || String(before.tolerancePlus) !== String(c.tolerancePlus) || String(before.toleranceMinus) !== String(c.toleranceMinus);
        return changed ? { charNumber: c.charNumber, name: c.name, change: "changed" } : null;
      })
      .filter(Boolean);
    return { siteChanged: current.configuration.supplierProductId !== proposed.configuration.supplierProductId, baseline, requirements, characteristics };
  }

  async get(actor: Actor, id: string) {
    const scope = AccessScope.of(actor);
    const cr = await this.db.client.changeRequest.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true, supplierNumber: true, status: true } },
        supplierProduct: { select: { id: true, status: true } },
        internalPart: { select: { id: true, partNumber: true, description: true, criticality: true } },
        supplierPart: { select: { id: true, supplierPartNumber: true } },
        currentSite: { select: { id: true, siteCode: true, name: true, country: true } },
        proposedSite: { select: { id: true, siteCode: true, name: true, country: true } },
        currentRevision: { include: REVISION_INCLUDE },
        proposedRevision: { include: REVISION_INCLUDE },
        categories: true,
        impactAssessments: { orderBy: { discipline: "asc" } },
        requalification: { select: { id: true, number: true, status: true, riskLevel: true, configurationRevisionId: true } },
        submittedByOrganization: { select: { id: true, name: true, type: true } },
      },
    });
    if (!cr || (!scope.isInternal && (!cr.supplierVisible || cr.supplierId !== scope.supplierId))) throw new NotFoundError("Change request");
    const requirements = await this.db.client.requiredDocument.findMany({
      where: { changeRequestId: id },
      include: { documentType: { select: { id: true, code: true, name: true, acronym: true } }, document: { select: { id: true, docNumber: true, title: true, status: true } } },
      orderBy: { createdAt: "asc" },
    });
    const { categories, impactAssessments, ...rest } = cr;
    const base = {
      ...rest,
      categories: categories.map((c) => c.category),
      comparison: this.compareRevisions(cr.currentRevision, cr.proposedRevision),
      requiredDocuments: requirements,
    };
    if (!scope.isInternal) {
      // Internal impact evaluation and requalification planning are not disclosed to supplier users.
      const { requalification: _q, riskAssessment: _r, ...external } = base;
      return external;
    }
    const gate = cr.requalification ? await this.qualifications.evaluateGate(this.db.client as unknown as Tx, cr.requalification.id) : null;
    return { ...base, impactAssessments, gate };
  }

  // ------------------------------------------------------------------ helpers

  private async lock(tx: Tx, id: string, expectedVersion?: number) {
    await this.db.lockRow(tx, "change_requests", id);
    const cr = await tx.changeRequest.findUnique({ where: { id }, include: { categories: true } });
    if (!cr) throw new NotFoundError("Change request");
    if (expectedVersion !== undefined && cr.version !== expectedVersion) throw new StaleVersionError("Change request");
    return cr;
  }

  /** Suppliers act only on their own (visible) change requests; internal users on all. */
  private assertActorScope(actor: Actor, cr: { supplierId: string; supplierVisible: boolean }) {
    const scope = AccessScope.of(actor);
    if (!scope.isInternal && (!cr.supplierVisible || cr.supplierId !== scope.supplierId)) throw new NotFoundError("Change request");
  }

  private async assertNotUnderApproval(tx: Tx, cr: { workflowInstanceId: string | null; number: string }) {
    if (!cr.workflowInstanceId) return;
    const wf = await tx.workflowInstance.findUnique({ where: { id: cr.workflowInstanceId } });
    if (wf?.status === "ACTIVE") throw new ConflictError(`Change request ${cr.number} is under approval`, "UNDER_APPROVAL");
  }

  // ------------------------------------------------------------------ create & edit

  async create(actor: Actor, dto: CreateChangeRequestDto) {
    const scope = AccessScope.of(actor);
    return this.db.tx(async (tx, after) => {
      const sp = await tx.supplierProduct.findFirst({ where: { id: dto.supplierProductId, archivedAt: null }, include: { internalPart: true, supplierPart: true, site: true } });
      if (!sp) throw new NotFoundError("Supplier product");
      scope.assertSupplier(sp.supplierId, "Supplier product");
      const approvals = await tx.productApproval.findMany({ where: { supplierProductId: sp.id, status: "ACTIVE" }, include: { configurationRevision: { include: { configuration: true } } } });
      if (!approvals.length) throw new BusinessRuleError("The supplier product has no active product approval; changes are controlled once a configuration is approved");
      const approval = dto.currentRevisionId ? approvals.find((a) => a.configurationRevisionId === dto.currentRevisionId) : approvals.length === 1 ? approvals[0] : undefined;
      if (!approval) {
        throw new BusinessRuleError(dto.currentRevisionId ? "The revision is not an approved configuration of this supplier product" : "Select the approved configuration revision affected by the change");
      }
      const currentRev = approval.configurationRevision;
      const categories = [...new Set(dto.categories)];
      const isLocation = categories.includes("LOCATION");
      let proposedSite: { id: string; siteCode: string; status: string } | null = null;
      if (isLocation) {
        if (!dto.proposedSiteId) throw new BusinessRuleError("A location change must identify the proposed manufacturing site");
        proposedSite = await tx.supplierSite.findFirst({ where: { id: dto.proposedSiteId, supplierId: sp.supplierId, archivedAt: null } });
        if (!proposedSite) throw new BusinessRuleError("The proposed site must be a site of the same supplier");
        if (proposedSite.id === sp.siteId) throw new BusinessRuleError("The proposed site is the current manufacturing site");
        if (["SUSPENDED", "INACTIVE"].includes(proposedSite.status)) throw new BusinessRuleError(`Site ${proposedSite.siteCode} is ${proposedSite.status}`);
      } else if (dto.proposedSiteId) {
        throw new BusinessRuleError("A proposed site applies only to location changes");
      }

      // One open change per authorized configuration.
      await this.db.lockRow(tx, "product_configurations", currentRev.configurationId);
      const active = await tx.changeRequest.findFirst({ where: { currentRevisionId: currentRev.id, status: { in: OPEN_STATUSES } } });
      if (active) throw new ConflictError(`Change request ${active.number} is already open for this configuration`, "CHANGE_IN_PROGRESS");
      const openRev = await tx.configurationRevision.findFirst({ where: { configurationId: currentRev.configurationId, status: { in: ["DRAFT", "PROPOSED", "IN_REVIEW"] } } });
      if (openRev && !isLocation) throw new ConflictError(`Revision ${openRev.revisionLabel} of ${currentRev.configuration.configCode} is already open; complete or withdraw it first`, "OPEN_REVISION_EXISTS");

      const number = await this.numbering.next(tx, "CHANGE_REQUEST");
      const summary = `Proposed by ${number}: ${dto.title}`.slice(0, 500);
      let proposedRevId: string;
      if (proposedSite) {
        const key = { internalPartId: sp.internalPartId, supplierPartId: sp.supplierPartId, siteId: proposedSite.id };
        const target =
          (await tx.supplierProduct.findUnique({ where: { internalPartId_supplierPartId_siteId: key } })) ??
          (await tx.supplierProduct.create({ data: { ...key, supplierId: sp.supplierId } }));
        proposedRevId = (await this.configurations.cloneForSupplierProduct(tx, actor.userId, currentRev.id, target.id, summary)).revision.id;
      } else {
        proposedRevId = (await this.configurations.copyRevision(tx, currentRev.id, { status: "PROPOSED", changeSummary: summary, createdById: actor.userId })).id;
      }

      const cr = await tx.changeRequest.create({
        data: {
          number,
          title: dto.title,
          supplierId: sp.supplierId,
          supplierProductId: sp.id,
          internalPartId: sp.internalPartId,
          supplierPartId: sp.supplierPartId,
          currentSiteId: sp.siteId,
          proposedSiteId: proposedSite?.id ?? null,
          currentRevisionId: currentRev.id,
          proposedRevisionId: proposedRevId,
          reason: dto.reason,
          description: dto.description,
          affectedCharacteristics: dto.affectedCharacteristics ?? null,
          proposedImplementationDate: toDate(dto.proposedImplementationDate) ?? null,
          inventoryImpact: dto.inventoryImpact ?? null,
          wipImpact: dto.wipImpact ?? null,
          riskAssessment: dto.riskAssessment ?? null,
          submittedByOrganizationId: actor.organizationId,
          createdById: actor.userId,
          categories: { create: categories.map((category) => ({ category })) },
        },
      });
      await this.audit.record(
        { eventType: "change_request.created", entityType: "CHANGE_REQUEST", entityId: cr.id, entityLabel: number, metadata: { categories, currentRevisionId: currentRev.id, proposedRevisionId: proposedRevId, proposedSiteId: proposedSite?.id ?? null } },
        tx,
      );
      await this.activity.record(tx, {
        entityType: "CHANGE_REQUEST",
        entityId: cr.id,
        entityLabel: number,
        verb: "created",
        summary: `Change request ${number} created for ${sp.internalPart.partNumber} / ${sp.supplierPart.supplierPartNumber} (${categories.join(", ")})${proposedSite ? ` - relocation ${sp.site.siteCode} → ${proposedSite.siteCode}` : ""}`,
        visibility: "SUPPLIER",
        supplierId: sp.supplierId,
        internalPartId: sp.internalPartId,
      });
      void after;
      return tx.changeRequest.findUniqueOrThrow({ where: { id: cr.id } });
    });
  }

  async update(actor: Actor, id: string, dto: UpdateChangeRequestDto) {
    const { expectedVersion, categories, proposedImplementationDate, ...rest } = dto;
    return this.db.tx(async (tx) => {
      const before = await this.lock(tx, id, expectedVersion);
      this.assertActorScope(actor, before);
      if (!EDITABLE_STATUSES.includes(before.status)) throw new InvalidTransitionError("Change request", before.status, "edited");
      if (categories) {
        const wasLocation = before.categories.some((c) => c.category === "LOCATION");
        if (wasLocation !== categories.includes("LOCATION")) throw new BusinessRuleError("Adding or removing a location change requires a new change request");
        await tx.changeRequestCategory.deleteMany({ where: { changeRequestId: id } });
        await tx.changeRequestCategory.createMany({ data: [...new Set(categories)].map((category) => ({ changeRequestId: id, category })) });
      }
      const after = await tx.changeRequest.update({
        where: { id },
        data: { ...rest, ...(proposedImplementationDate !== undefined ? { proposedImplementationDate: toDate(proposedImplementationDate) } : {}), version: { increment: 1 } },
      });
      const changes = diffControlled(before, after, ["title", "reason", "description", "affectedCharacteristics", "proposedImplementationDate", "inventoryImpact", "wipImpact", "riskAssessment"]);
      await this.audit.record({ eventType: "change_request.updated", entityType: "CHANGE_REQUEST", entityId: id, entityLabel: before.number, changes, metadata: categories ? { categories } : undefined }, tx);
      return after;
    });
  }

  // ------------------------------------------------------------------ lifecycle

  async submit(actor: Actor, id: string, expectedVersion: number) {
    return this.db.tx(async (tx, after) => {
      const cr = await this.lock(tx, id, expectedVersion);
      this.assertActorScope(actor, cr);
      if (!EDITABLE_STATUSES.includes(cr.status)) throw new InvalidTransitionError("Change request", cr.status, "submitted");
      const resubmission = cr.status === "INFO_REQUIRED";
      await tx.changeRequest.update({ where: { id }, data: { status: "SUBMITTED", submittedAt: new Date(), submittedById: actor.userId, version: { increment: 1 } } });
      await this.audit.record({ eventType: resubmission ? "change_request.resubmitted" : "change_request.submitted", entityType: "CHANGE_REQUEST", entityId: id, entityLabel: cr.number, changes: { status: { before: cr.status, after: "SUBMITTED" } } }, tx);
      await this.activity.record(tx, { entityType: "CHANGE_REQUEST", entityId: id, entityLabel: cr.number, verb: "submitted", summary: resubmission ? "Resubmitted with the requested information" : "Submitted for review", visibility: "SUPPLIER", supplierId: cr.supplierId, internalPartId: cr.internalPartId });
      await this.notifications.notify(tx, after, { eventType: "change_request.submitted", title: `Change request ${cr.number} submitted: ${cr.title}`, entityType: "CHANGE_REQUEST", entityId: id, link: `/changes/${id}`, roleKeys: ["SUPPLIER_QUALITY", "ENGINEERING"], excludeUserIds: [actor.userId] });
      await this.outbox.publish(tx, "change_request.submitted", "CHANGE_REQUEST", id, { number: cr.number, supplierId: cr.supplierId });
      return tx.changeRequest.findUniqueOrThrow({ where: { id } });
    });
  }

  async requestInformation(actor: Actor, id: string, expectedVersion: number, reason: string) {
    return this.db.tx(async (tx, after) => {
      const cr = await this.lock(tx, id, expectedVersion);
      if (!REVIEW_STATUSES.includes(cr.status)) throw new InvalidTransitionError("Change request", cr.status, "returned for information");
      await this.assertNotUnderApproval(tx, cr);
      await tx.changeRequest.update({ where: { id }, data: { status: "INFO_REQUIRED", infoRequest: reason, version: { increment: 1 } } });
      await this.audit.record({ eventType: "change_request.info_requested", entityType: "CHANGE_REQUEST", entityId: id, entityLabel: cr.number, changes: { status: { before: cr.status, after: "INFO_REQUIRED" } }, reason }, tx);
      await this.activity.record(tx, { entityType: "CHANGE_REQUEST", entityId: id, entityLabel: cr.number, verb: "info_requested", summary: `Additional information requested: ${reason}`, visibility: "SUPPLIER", supplierId: cr.supplierId, internalPartId: cr.internalPartId });
      await this.notifications.notify(tx, after, { eventType: "change_request.info_requested", title: `Information requested on ${cr.number}`, body: reason, entityType: "CHANGE_REQUEST", entityId: id, link: `/changes/${id}`, userIds: [cr.createdById] });
      return tx.changeRequest.findUniqueOrThrow({ where: { id } });
    });
  }

  /** Records (or replaces) one discipline's impact assessment for the CIRD. */
  async recordAssessment(actor: Actor, id: string, dto: ImpactAssessmentDto) {
    return this.db.tx(async (tx) => {
      const cr = await this.lock(tx, id);
      if (!REVIEW_STATUSES.includes(cr.status)) throw new InvalidTransitionError("Change request", cr.status, "assessed");
      await this.assertNotUnderApproval(tx, cr);
      const { discipline, ...data } = dto;
      const assessment = await tx.changeImpactAssessment.upsert({
        where: { changeRequestId_discipline: { changeRequestId: id, discipline } },
        update: { ...data, assessorId: actor.userId },
        create: { ...data, discipline, changeRequestId: id, assessorId: actor.userId },
      });
      if (cr.status === "SUBMITTED") await tx.changeRequest.update({ where: { id }, data: { status: "UNDER_REVIEW", version: { increment: 1 } } });
      else await tx.changeRequest.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.audit.record({ eventType: "change_request.impact_assessed", entityType: "CHANGE_REQUEST", entityId: id, entityLabel: cr.number, metadata: { discipline, recommendation: dto.recommendation, assessmentId: assessment.id } }, tx);
      await this.activity.record(tx, { entityType: "CHANGE_REQUEST", entityId: id, entityLabel: cr.number, verb: "impact_assessed", summary: `${discipline} impact assessment: ${dto.recommendation}`, supplierId: cr.supplierId, internalPartId: cr.internalPartId });
      return assessment;
    });
  }

  /**
   * Change Impact & Requalification Decision: combines discipline assessments into the validation evidence required,
   * creates those document requirements and opens a requalification for the proposed configuration revision.
   */
  async decideRequalification(actor: Actor, id: string, dto: RequalificationDecisionDto) {
    return this.db.tx(async (tx) => {
      const cr = await this.lock(tx, id, dto.expectedVersion);
      if (!["UNDER_REVIEW", "VALIDATION_REQUIRED"].includes(cr.status)) throw new InvalidTransitionError("Change request", cr.status, "dispositioned for requalification");
      await this.assertNotUnderApproval(tx, cr);
      if (!cr.proposedRevisionId) throw new BusinessRuleError("The change request has no proposed configuration");
      const assessments = await tx.changeImpactAssessment.findMany({ where: { changeRequestId: id } });
      const missing = (["ENGINEERING", "QUALITY"] as const).filter((d) => !assessments.some((a) => a.discipline === d));
      if (missing.length) throw new BusinessRuleError(`Impact assessments are required from: ${missing.join(", ")}`);

      const flags = Object.keys(CHANGE_VALIDATION_DOCUMENTS).filter((flag) => assessments.some((a) => (a as unknown as Record<string, boolean>)[flag]));
      const docs = new Map<string, string>();
      for (const flag of flags) for (const d of CHANGE_VALIDATION_DOCUMENTS[flag]) docs.set(d.code, d.reason);
      if (cr.categories.some((c) => c.category === "LOCATION") && !docs.has("VAL-02")) docs.set("VAL-02", "Manufacturing location change requires a first-article inspection at the new site.");
      const types = await tx.documentType.findMany({ where: { code: { in: [...docs.keys()] }, status: "ACTIVE" } });
      const existing = await tx.requiredDocument.findMany({ where: { changeRequestId: id }, select: { documentTypeId: true } });
      let added = 0;
      for (const t of types) {
        if (existing.some((e) => e.documentTypeId === t.id)) continue;
        await tx.requiredDocument.create({ data: { changeRequestId: id, documentTypeId: t.id, level: "REQUIRED", status: "OPEN", source: "CHANGE_ASSESSMENT", reason: docs.get(t.code)!.slice(0, 500), addedById: actor.userId } });
        added++;
      }

      let qual = await tx.productQualification.findFirst({ where: { changeRequestId: id, status: { notIn: ["REJECTED"] } } });
      if (!qual) {
        qual = await this.qualifications.create(actor, { configurationRevisionId: cr.proposedRevisionId, title: `Requalification for ${cr.number}: ${cr.title}`.slice(0, 250) }, { tx, changeRequestId: id, riskLevel: dto.riskLevel as RiskLevel });
      } else {
        qual = await tx.productQualification.update({ where: { id: qual.id }, data: { riskLevel: dto.riskLevel as RiskLevel, version: { increment: 1 } } });
      }
      const status: ChangeRequestStatus = types.length ? "VALIDATION_REQUIRED" : "UNDER_REVIEW";
      await tx.changeRequest.update({ where: { id }, data: { status, riskLevel: dto.riskLevel as RiskLevel, requiredValidation: dto.requiredValidation ?? null, version: { increment: 1 } } });
      await this.audit.record(
        { eventType: "change_request.requalification_decided", entityType: "CHANGE_REQUEST", entityId: id, entityLabel: cr.number, changes: { status: { before: cr.status, after: status } }, metadata: { riskLevel: dto.riskLevel, flags, documents: types.map((t) => t.code), qualificationId: qual.id } },
        tx,
      );
      await this.activity.record(tx, {
        entityType: "CHANGE_REQUEST",
        entityId: id,
        entityLabel: cr.number,
        verb: "requalification_decided",
        summary: types.length ? `Requalification required (${types.map((t) => t.code).join(", ")}); risk ${dto.riskLevel}; ${qual.number} opened` : `No additional validation evidence required; risk ${dto.riskLevel}; ${qual.number} opened`,
        supplierId: cr.supplierId,
        internalPartId: cr.internalPartId,
      });
      return { status, riskLevel: dto.riskLevel, requiredDocuments: types.map((t) => t.code), added, qualificationId: qual.id };
    });
  }

  async submitForApproval(actor: Actor, id: string, expectedVersion: number, dispositionConditions?: string) {
    return this.db.tx(async (tx, after) => {
      const cr = await this.lock(tx, id, expectedVersion);
      if (!["UNDER_REVIEW", "VALIDATION_REQUIRED"].includes(cr.status)) throw new InvalidTransitionError("Change request", cr.status, "submitted for approval");
      await this.assertNotUnderApproval(tx, cr);
      const qual = await tx.productQualification.findFirst({ where: { changeRequestId: id, status: { notIn: ["REJECTED", "APPROVED"] } } });
      if (!qual) throw new BusinessRuleError("Record the requalification decision (CIRD) before requesting approval");
      await this.db.lockRow(tx, "product_qualifications", qual.id);
      await this.db.lockRow(tx, "configuration_revisions", qual.configurationRevisionId);
      const checks = await this.qualifications.evaluateGate(tx, qual.id);
      if (checks.some((c) => !c.passed)) throw new ApprovalGateError(checks);
      const rev = await tx.configurationRevision.update({ where: { id: qual.configurationRevisionId }, data: { status: "IN_REVIEW", version: { increment: 1 } } });
      await tx.productQualification.update({ where: { id: qual.id }, data: { status: "APPROVAL_REVIEW", approvalRestrictions: dispositionConditions?.trim() || null, version: { increment: 1 } } });
      const accepted = await tx.requiredDocument.findMany({ where: { OR: [{ changeRequestId: id }, { qualificationId: qual.id }], status: "ACCEPTED" }, select: { acceptedRevisionId: true } });
      const ref = createHash("sha256").update(canonicalJson({ revisionVersion: rev.version, documents: accepted.map((a) => a.acceptedRevisionId).filter(Boolean).sort(), conditions: dispositionConditions ?? null })).digest("hex");
      const instance = await this.workflow.start(tx, after, {
        definitionKey: "change-request-approval",
        subjectType: "CHANGE_REQUEST",
        subjectId: id,
        subjectLabel: `${cr.number} ${cr.title}`,
        subjectVersionRef: ref,
        link: `/changes/${id}`,
        context: { riskLevel: cr.riskLevel ?? qual.riskLevel },
        startedById: actor.userId,
      });
      await tx.changeRequest.update({ where: { id }, data: { status: "UNDER_REVIEW", dispositionConditions: dispositionConditions?.trim() || null, workflowInstanceId: instance.id, version: { increment: 1 } } });
      await this.audit.record({ eventType: "change_request.submitted_for_approval", entityType: "CHANGE_REQUEST", entityId: id, entityLabel: cr.number, metadata: { qualificationId: qual.id, gate: checks.map((c) => ({ key: c.key, passed: c.passed })), conditions: dispositionConditions ?? null } }, tx);
      await this.activity.record(tx, { entityType: "CHANGE_REQUEST", entityId: id, entityLabel: cr.number, verb: "approval_requested", summary: "Submitted for change approval; requalification gate checks passed", supplierId: cr.supplierId, internalPartId: cr.internalPartId });
      return tx.changeRequest.findUniqueOrThrow({ where: { id } });
    });
  }

  // ------------------------------------------------------------------ workflow outcomes

  async onApproved(tx: Tx, after: AfterCommit, instance: WorkflowInstance): Promise<void> {
    await this.db.lockRow(tx, "change_requests", instance.subjectId);
    const cr = await tx.changeRequest.findUniqueOrThrow({ where: { id: instance.subjectId }, include: { categories: true, currentSite: true, proposedSite: true } });
    const qual = await tx.productQualification.findFirst({ where: { changeRequestId: cr.id, status: "APPROVAL_REVIEW" } });
    if (!qual) throw new BusinessRuleError("The change requalification is not under approval review");
    const approvals = await this.qualifications.approvalsOf(tx, instance.id);
    // Re-validates the gate, authorizes the proposed revision and supersedes (but retains) the previous approval.
    const approval = await this.qualifications.finalizeApproval(tx, after, qual.id, approvals, { changeRequestId: cr.id });
    const now = new Date();
    if (cr.proposedSiteId) {
      // Relocation: the approval at the previous site is superseded by the approval at the new site.
      await tx.productApproval.updateMany({ where: { configurationRevisionId: cr.currentRevisionId, status: { in: ["ACTIVE", "SUSPENDED"] } }, data: { status: "SUPERSEDED", supersededAt: now, supersededByChangeRequestId: cr.id } });
      await tx.configurationRevision.update({ where: { id: cr.currentRevisionId }, data: { status: "SUPERSEDED", supersededAt: now, supersededByRevisionId: cr.proposedRevisionId, version: { increment: 1 } } });
      await tx.supplierProduct.update({ where: { id: cr.supplierProductId }, data: { status: "INACTIVE", statusReason: `Production transferred to ${cr.proposedSite?.siteCode} by ${cr.number}`, version: { increment: 1 } } });
    }
    const disposition = cr.dispositionConditions ? "APPROVED_WITH_CONDITIONS" : "APPROVED";
    const decidedById = RequestContext.get()?.actor?.userId ?? null;
    await tx.changeRequest.update({ where: { id: cr.id }, data: { status: "APPROVED", disposition, decidedAt: now, decidedById, version: { increment: 1 } } });
    await this.audit.record(
      { eventType: "change_request.approved", entityType: "CHANGE_REQUEST", entityId: cr.id, entityLabel: cr.number, changes: { status: { before: cr.status, after: "APPROVED" } }, metadata: { disposition, productApprovalId: approval.id, previousRevisionId: cr.currentRevisionId, approvedRevisionId: cr.proposedRevisionId } },
      tx,
    );
    await this.activity.record(tx, {
      entityType: "CHANGE_REQUEST",
      entityId: cr.id,
      entityLabel: cr.number,
      verb: "approved",
      summary: `Change ${disposition === "APPROVED" ? "approved" : `approved with conditions: ${cr.dispositionConditions}`} (${approval.number}). Shipment of changed product requires implementation verification.`,
      visibility: "SUPPLIER",
      supplierId: cr.supplierId,
      internalPartId: cr.internalPartId,
    });
    await this.notifications.notify(tx, after, { eventType: "change_request.approved", title: `Change request ${cr.number} approved`, entityType: "CHANGE_REQUEST", entityId: cr.id, link: `/changes/${cr.id}`, userIds: [cr.createdById], roleKeys: ["SUPPLIER_QUALITY"] });
    await this.outbox.publish(tx, "change_request.approved", "CHANGE_REQUEST", cr.id, { number: cr.number, disposition, productApproval: approval.number, conditions: cr.dispositionConditions });
  }

  async onRejected(tx: Tx, after: AfterCommit, instance: WorkflowInstance, comment: string): Promise<void> {
    const cr = await tx.changeRequest.findUniqueOrThrow({ where: { id: instance.subjectId } });
    const now = new Date();
    const decidedById = RequestContext.get()?.actor?.userId ?? null;
    await tx.changeRequest.update({ where: { id: cr.id }, data: { status: "REJECTED", disposition: "REJECTED", decisionComment: comment, decidedAt: now, decidedById, version: { increment: 1 } } });
    // The proposed configuration is rejected; the authorized configuration and its approval remain unchanged.
    if (cr.proposedRevisionId) await tx.configurationRevision.update({ where: { id: cr.proposedRevisionId }, data: { status: "REJECTED", version: { increment: 1 } } });
    await tx.productQualification.updateMany({ where: { changeRequestId: cr.id, status: { notIn: ["APPROVED", "REJECTED"] } }, data: { status: "REJECTED", decisionComment: comment, decidedAt: now, decidedById, version: { increment: 1 } } });
    if (cr.proposedSiteId) await this.retireProposedSiteProduct(tx, cr.proposedRevisionId, `Relocation rejected (${cr.number})`);
    await this.audit.record({ eventType: "change_request.rejected", entityType: "CHANGE_REQUEST", entityId: cr.id, entityLabel: cr.number, changes: { status: { before: cr.status, after: "REJECTED" } }, reason: comment }, tx);
    await this.activity.record(tx, { entityType: "CHANGE_REQUEST", entityId: cr.id, entityLabel: cr.number, verb: "rejected", summary: `Change rejected: ${comment}. The approved configuration remains in effect.`, visibility: "SUPPLIER", supplierId: cr.supplierId, internalPartId: cr.internalPartId });
    await this.notifications.notify(tx, after, { eventType: "change_request.rejected", title: `Change request ${cr.number} rejected`, body: comment, entityType: "CHANGE_REQUEST", entityId: cr.id, link: `/changes/${cr.id}`, userIds: [cr.createdById] });
    await this.outbox.publish(tx, "change_request.rejected", "CHANGE_REQUEST", cr.id, { number: cr.number });
  }

  async onInfoRequested(tx: Tx, after: AfterCommit, instance: WorkflowInstance, comment: string): Promise<void> {
    const cr = await tx.changeRequest.findUniqueOrThrow({ where: { id: instance.subjectId } });
    await tx.changeRequest.update({ where: { id: cr.id }, data: { status: "INFO_REQUIRED", infoRequest: comment, version: { increment: 1 } } });
    if (cr.proposedRevisionId) await tx.configurationRevision.update({ where: { id: cr.proposedRevisionId }, data: { status: "PROPOSED", version: { increment: 1 } } });
    await tx.productQualification.updateMany({ where: { changeRequestId: cr.id, status: "APPROVAL_REVIEW" }, data: { status: "VALIDATION", decisionComment: comment, version: { increment: 1 } } });
    await this.activity.record(tx, { entityType: "CHANGE_REQUEST", entityId: cr.id, entityLabel: cr.number, verb: "info_requested", summary: `Returned for more information: ${comment}`, visibility: "SUPPLIER", supplierId: cr.supplierId, internalPartId: cr.internalPartId });
    await this.notifications.notify(tx, after, { eventType: "change_request.info_requested", title: `Information requested on ${cr.number}`, body: comment, entityType: "CHANGE_REQUEST", entityId: cr.id, link: `/changes/${cr.id}`, userIds: [cr.createdById] });
  }

  private async retireProposedSiteProduct(tx: Tx, proposedRevisionId: string | null, reason: string) {
    if (!proposedRevisionId) return;
    const rev = await tx.configurationRevision.findUnique({ where: { id: proposedRevisionId }, include: { configuration: true } });
    if (!rev) return;
    const active = await tx.productApproval.count({ where: { supplierProductId: rev.configuration.supplierProductId, status: "ACTIVE" } });
    if (!active) await tx.supplierProduct.update({ where: { id: rev.configuration.supplierProductId }, data: { status: "INACTIVE", statusReason: reason, version: { increment: 1 } } });
  }

  // ------------------------------------------------------------------ post-approval

  /** Verifies the approved change is implemented; only then is shipment of changed product authorized. */
  async verifyImplementation(actor: Actor, id: string, expectedVersion: number, notes: string) {
    return this.db.tx(async (tx, after) => {
      const cr = await this.lock(tx, id, expectedVersion);
      if (cr.status !== "APPROVED") throw new InvalidTransitionError("Change request", cr.status, "verified");
      const now = new Date();
      await tx.changeRequest.update({ where: { id }, data: { status: "IMPLEMENTATION_VERIFIED", implementationNotes: notes, implementationVerifiedById: actor.userId, implementationVerifiedAt: now, shipmentAuthorizedAt: now, version: { increment: 1 } } });
      await this.audit.record({ eventType: "change_request.implementation_verified", entityType: "CHANGE_REQUEST", entityId: id, entityLabel: cr.number, changes: { status: { before: "APPROVED", after: "IMPLEMENTATION_VERIFIED" } }, reason: notes }, tx);
      await this.activity.record(tx, { entityType: "CHANGE_REQUEST", entityId: id, entityLabel: cr.number, verb: "implementation_verified", summary: `Implementation verified; shipment of changed product authorized. ${notes}`, visibility: "SUPPLIER", supplierId: cr.supplierId, internalPartId: cr.internalPartId });
      await this.notifications.notify(tx, after, { eventType: "change_request.shipment_authorized", title: `Shipment authorized for ${cr.number}`, entityType: "CHANGE_REQUEST", entityId: id, link: `/changes/${id}`, userIds: [cr.createdById], roleKeys: ["SOURCING"] });
      await this.outbox.publish(tx, "change_request.shipment_authorized", "CHANGE_REQUEST", id, { number: cr.number });
      return tx.changeRequest.findUniqueOrThrow({ where: { id } });
    });
  }

  async close(actor: Actor, id: string, expectedVersion: number) {
    return this.db.tx(async (tx) => {
      const cr = await this.lock(tx, id, expectedVersion);
      if (cr.status !== "IMPLEMENTATION_VERIFIED" && cr.status !== "REJECTED") throw new InvalidTransitionError("Change request", cr.status, "closed");
      await tx.changeRequest.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date(), version: { increment: 1 } } });
      await this.audit.record({ eventType: "change_request.closed", entityType: "CHANGE_REQUEST", entityId: id, entityLabel: cr.number, changes: { status: { before: cr.status, after: "CLOSED" } } }, tx);
      return tx.changeRequest.findUniqueOrThrow({ where: { id } });
    });
  }

  async withdraw(actor: Actor, id: string, expectedVersion: number, reason: string) {
    return this.db.tx(async (tx) => {
      const cr = await this.lock(tx, id, expectedVersion);
      this.assertActorScope(actor, cr);
      if (!OPEN_STATUSES.includes(cr.status)) throw new InvalidTransitionError("Change request", cr.status, "withdrawn");
      const scope = AccessScope.of(actor);
      if (!scope.isInternal && cr.submittedByOrganizationId !== actor.organizationId) throw new ForbiddenError("Only the submitting organization can withdraw this change request");
      await this.workflow.cancelForSubject(tx, "CHANGE_REQUEST", id, reason);
      const now = new Date();
      await tx.changeRequest.update({ where: { id }, data: { status: "WITHDRAWN", withdrawnAt: now, decisionComment: reason, version: { increment: 1 } } });
      if (cr.proposedRevisionId) await tx.configurationRevision.update({ where: { id: cr.proposedRevisionId }, data: { status: "WITHDRAWN", version: { increment: 1 } } });
      await tx.productQualification.updateMany({ where: { changeRequestId: id, status: { notIn: ["APPROVED", "REJECTED"] } }, data: { status: "REJECTED", decisionComment: `Change request withdrawn: ${reason}`, decidedAt: now, version: { increment: 1 } } });
      await tx.requiredDocument.updateMany({ where: { changeRequestId: id, status: { in: ["OPEN", "REJECTED"] } }, data: { status: "NOT_APPLICABLE", reason: `Change request withdrawn` } });
      if (cr.proposedSiteId) await this.retireProposedSiteProduct(tx, cr.proposedRevisionId, `Relocation withdrawn (${cr.number})`);
      await this.audit.record({ eventType: "change_request.withdrawn", entityType: "CHANGE_REQUEST", entityId: id, entityLabel: cr.number, changes: { status: { before: cr.status, after: "WITHDRAWN" } }, reason }, tx);
      await this.activity.record(tx, { entityType: "CHANGE_REQUEST", entityId: id, entityLabel: cr.number, verb: "withdrawn", summary: `Withdrawn: ${reason}`, visibility: "SUPPLIER", supplierId: cr.supplierId, internalPartId: cr.internalPartId });
      return tx.changeRequest.findUniqueOrThrow({ where: { id } });
    });
  }
}
