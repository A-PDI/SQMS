import { createHash } from "node:crypto";
import { Injectable, OnModuleInit } from "@nestjs/common";
import type { Prisma, ProductQualificationStatus, RiskLevel, SourcingPathwayCode, WorkflowInstance } from "@sqms/db";
import { canonicalJson, DEFAULT_QUALIFICATION_WORKFLOW_MATRIX } from "@sqms/shared";
import type { Actor } from "../../common/auth/actor";
import { AccessScope } from "../../common/auth/access-scope";
import { ActivityService } from "../../common/audit/activity.service";
import { AuditService, diffControlled } from "../../common/audit/audit.service";
import { RequestContext } from "../../common/context/request-context";
import { DbService, type AfterCommit, type Tx } from "../../common/db/db.service";
import { ApprovalGateError, BusinessRuleError, ConflictError, InvalidTransitionError, NotFoundError, StaleVersionError, type GateCheck } from "../../common/errors/app-errors";
import { toDate } from "../../common/http/dto-helpers";
import { pageArgs, sortArg, trimQ, type Page } from "../../common/http/pagination";
import { NotificationService } from "../../common/services/notification.service";
import { NumberingService } from "../../common/services/numbering.service";
import { OutboxService } from "../../common/services/outbox.service";
import { SettingsService } from "../../common/services/settings.service";
import { DocumentsService } from "../documents/documents.service";
import { WorkflowService, type WorkflowSubjectHandler } from "../workflow/workflow.service";
import type { CreateQualificationDto, FaiDto, InspectionResultDto, QualificationListQuery, TestDto, TestResultDto, UpdateQualificationDto } from "./qualifications.dto";

const CLOSED_STATUSES: ProductQualificationStatus[] = ["APPROVED", "REJECTED"];
const OPEN_NCR = ["OPEN", "CONTAINED", "UNDER_INVESTIGATION"] as const;

export interface ApprovalRecord {
  step: string;
  decision: string;
  decidedById: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  subjectRef: string | null;
}

@Injectable()
export class QualificationsService implements OnModuleInit, WorkflowSubjectHandler {
  readonly subjectType = "PRODUCT_QUALIFICATION" as const;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly numbering: NumberingService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationService,
    private readonly settings: SettingsService,
    private readonly workflow: WorkflowService,
    private readonly documents: DocumentsService,
  ) {}

  onModuleInit(): void {
    this.workflow.registerHandler(this);
  }

  async workflowKeyFor(pathway: SourcingPathwayCode | null, risk: RiskLevel): Promise<string> {
    const matrix = await this.settings.get<Record<string, Record<string, string>>>("qualification.workflowMatrix", DEFAULT_QUALIFICATION_WORKFLOW_MATRIX);
    return matrix[pathway ?? "B"]?.[risk] ?? (risk === "HIGH" || risk === "CRITICAL" ? "product-qualification-high-risk" : "product-qualification-standard");
  }

  // ------------------------------------------------------------------ create & queries

  async create(actor: Actor, dto: CreateQualificationDto, opts: { tx?: Tx; changeRequestId?: string; riskLevel?: RiskLevel } = {}) {
    const run = async (tx: Tx) => {
      let project = dto.sourcingProjectId ? await tx.sourcingProject.findFirst({ where: { id: dto.sourcingProjectId, archivedAt: null } }) : null;
      if (dto.sourcingProjectId && !project) throw new NotFoundError("Sourcing project");
      let revisionId = dto.configurationRevisionId;
      if (project) {
        if (!["IN_PROGRESS", "QUALIFICATION"].includes(project.status)) throw new BusinessRuleError(`The sourcing project must be in progress (currently ${project.status})`);
        if (!project.configurationId) throw new BusinessRuleError("The project has no target configuration");
        const rev = await tx.configurationRevision.findFirst({ where: { configurationId: project.configurationId, status: { in: ["DRAFT", "PROPOSED"] } }, orderBy: { revisionNumber: "desc" } });
        if (!rev) throw new BusinessRuleError("The project configuration has no open revision to qualify");
        if (revisionId && revisionId !== rev.id) throw new BusinessRuleError("The configuration revision does not belong to the project");
        revisionId = rev.id;
      }
      if (!revisionId) throw new BusinessRuleError("A sourcing project or configuration revision is required");
      const rev = await tx.configurationRevision.findUnique({ where: { id: revisionId }, include: { configuration: { include: { supplierProduct: { include: { internalPart: true, supplierPart: true, site: true } } } } } });
      if (!rev) throw new NotFoundError("Configuration revision");
      if (!["DRAFT", "PROPOSED"].includes(rev.status)) throw new BusinessRuleError(`Revision ${rev.revisionLabel} is ${rev.status} and cannot be qualified`);
      const open = await tx.productQualification.findFirst({ where: { configurationRevisionId: rev.id, status: { notIn: CLOSED_STATUSES } } });
      if (open) throw new ConflictError(`Qualification ${open.number} is already open for this revision`, "QUALIFICATION_EXISTS");
      if (!project && !opts.changeRequestId) {
        project = await tx.sourcingProject.findFirst({ where: { configurationId: rev.configurationId, status: { in: ["IN_PROGRESS", "QUALIFICATION"] } } });
      }
      const risk = opts.riskLevel ?? (project ? (await tx.riskAssessment.findFirst({ where: { sourcingProjectId: project.id, isCurrent: true } }))?.level : null) ?? "MEDIUM";
      const pathway = project?.pathway ?? null;
      const workflowKey = opts.changeRequestId ? "change-request-approval" : await this.workflowKeyFor(pathway, risk);
      const sp = rev.configuration.supplierProduct;
      const number = await this.numbering.next(tx, "PRODUCT_QUALIFICATION");
      const q = await tx.productQualification.create({
        data: {
          number,
          title: dto.title ?? `${sp.internalPart.partNumber} / ${rev.configuration.customPartNumber ?? sp.supplierPart.supplierPartNumber} @ ${sp.site.siteCode} - ${rev.configuration.configCode} rev ${rev.revisionLabel}`.slice(0, 250),
          sourcingProjectId: project?.id ?? null,
          changeRequestId: opts.changeRequestId ?? null,
          supplierId: sp.supplierId,
          supplierProductId: sp.id,
          configurationRevisionId: rev.id,
          pathway,
          riskLevel: risk,
          workflowKey,
          requiredSampleQty: dto.requiredSampleQty ?? null,
          sampleNotes: dto.sampleNotes ?? null,
          inspectionPlanNotes: dto.inspectionPlanNotes ?? null,
          status: "DOCUMENTATION_PENDING",
          createdById: actor.userId,
        },
      });
      if (project && project.status === "IN_PROGRESS") await tx.sourcingProject.update({ where: { id: project.id }, data: { status: "QUALIFICATION", version: { increment: 1 } } });
      await tx.supplierProduct.update({ where: { id: sp.id }, data: { status: sp.status === "PROPOSED" ? "IN_QUALIFICATION" : sp.status } });
      await this.audit.record({ eventType: "qualification.created", entityType: "PRODUCT_QUALIFICATION", entityId: q.id, entityLabel: number, metadata: { configurationRevisionId: rev.id, riskLevel: risk, pathway, workflowKey, changeRequestId: opts.changeRequestId } }, tx);
      await this.activity.record(tx, { entityType: "PRODUCT_QUALIFICATION", entityId: q.id, entityLabel: number, verb: "created", summary: `Product qualification ${number} opened for ${rev.configuration.configCode} rev ${rev.revisionLabel} (risk ${risk}, workflow ${workflowKey})`, supplierId: sp.supplierId, internalPartId: sp.internalPartId, projectId: project?.id ?? null });
      return q;
    };
    return opts.tx ? run(opts.tx) : this.db.tx(run);
  }

  async list(actor: Actor, q: QualificationListQuery): Promise<Page<unknown>> {
    AccessScope.of(actor).requireInternal();
    const { skip, take, page, pageSize } = pageArgs(q);
    const term = trimQ(q.q);
    const where: Prisma.ProductQualificationWhereInput = {
      ...(q.status?.length ? { status: { in: q.status as ProductQualificationStatus[] } } : {}),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.internalPartId ? { supplierProduct: { internalPartId: q.internalPartId } } : {}),
      ...(q.sourcingProjectId ? { sourcingProjectId: q.sourcingProjectId } : {}),
      ...(term ? { OR: [{ number: { contains: term } }, { title: { contains: term } }] } : {}),
    };
    const [total, items] = await Promise.all([
      this.db.client.productQualification.count({ where }),
      this.db.client.productQualification.findMany({
        where,
        skip,
        take,
        orderBy: sortArg(q, ["number", "status", "createdAt", "updatedAt"] as const, "updatedAt"),
        include: { supplier: { select: { id: true, name: true } }, configurationRevision: { select: { id: true, revisionLabel: true, status: true, configuration: { select: { configCode: true } } } } },
      }),
    ]);
    return { total, page, pageSize, items };
  }

  async get(actor: Actor, id: string) {
    AccessScope.of(actor).requireInternal();
    const q = await this.db.client.productQualification.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true, supplierNumber: true, status: true } },
        supplierProduct: { include: { internalPart: { select: { id: true, partNumber: true, description: true, criticality: true } }, supplierPart: true, site: true } },
        configurationRevision: { include: { configuration: true, baseline: true, requirements: { orderBy: { code: "asc" } }, characteristics: { orderBy: { charNumber: "asc" } } } },
        sourcingProject: { select: { id: true, projectNumber: true, title: true, pathway: true } },
        changeRequest: { select: { id: true, number: true, title: true, status: true } },
        tests: { orderBy: { createdAt: "asc" } },
        firstArticles: { orderBy: { createdAt: "asc" }, include: { results: true } },
        inspectionResults: { orderBy: { inspectedAt: "asc" } },
        approvalPackage: { include: { items: { include: { documentRevision: { select: { id: true, revisionLabel: true, document: { select: { id: true, docNumber: true, title: true } } } } } } } },
        productApproval: true,
        deviations: { select: { id: true, number: true, status: true, type: true, blocksApproval: true } },
        nonconformances: { select: { id: true, number: true, status: true, severity: true, blocksApproval: true } },
      },
    });
    if (!q) throw new NotFoundError("Product qualification");
    const gate = await this.evaluateGate(this.db.client as unknown as Tx, id);
    return { ...q, gate };
  }

  // ------------------------------------------------------------------ editing

  private async lockQualification(tx: Tx, id: string, expectedVersion?: number) {
    await this.db.lockRow(tx, "product_qualifications", id);
    const q = await tx.productQualification.findUnique({ where: { id } });
    if (!q) throw new NotFoundError("Product qualification");
    if (expectedVersion !== undefined && q.version !== expectedVersion) throw new StaleVersionError("Product qualification");
    return q;
  }

  private assertOpen(q: { status: ProductQualificationStatus; number: string }) {
    if (CLOSED_STATUSES.includes(q.status) || q.status === "APPROVAL_REVIEW") {
      throw new ConflictError(`Qualification ${q.number} is ${q.status} and cannot be changed`, "CONTROLLED_RECORD");
    }
  }

  async update(actor: Actor, id: string, dto: UpdateQualificationDto) {
    const { expectedVersion, ...data } = dto;
    return this.db.tx(async (tx) => {
      const before = await this.lockQualification(tx, id, expectedVersion);
      this.assertOpen(before);
      const after = await tx.productQualification.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      await this.audit.record({ eventType: "qualification.updated", entityType: "PRODUCT_QUALIFICATION", entityId: id, entityLabel: before.number, changes: diffControlled(before, after, ["title", "requiredSampleQty", "approvalRestrictions", "deviationsSummary"]) }, tx);
      return after;
    });
  }

  async changeStatus(actor: Actor, id: string, expectedVersion: number, status: ProductQualificationStatus, reason?: string) {
    return this.db.tx(async (tx) => {
      const q = await this.lockQualification(tx, id, expectedVersion);
      if (status === "ON_HOLD") {
        this.assertOpen(q);
      } else if (q.status === "ON_HOLD" || ["DOCUMENTATION_PENDING", "EVALUATION", "VALIDATION"].includes(q.status)) {
        // free movement between working stages; approval only via submit-for-approval
      } else {
        throw new InvalidTransitionError("Qualification", q.status, `moved to ${status}`);
      }
      const after = await tx.productQualification.update({ where: { id }, data: { status, holdReason: status === "ON_HOLD" ? reason ?? null : null, version: { increment: 1 } } });
      await this.audit.record({ eventType: "qualification.status_changed", entityType: "PRODUCT_QUALIFICATION", entityId: id, entityLabel: q.number, changes: { status: { before: q.status, after: status } }, reason: reason ?? null }, tx);
      await this.activity.record(tx, { entityType: "PRODUCT_QUALIFICATION", entityId: id, entityLabel: q.number, verb: "status_changed", summary: `Status ${q.status} → ${status}${reason ? `: ${reason}` : ""}`, supplierId: q.supplierId, projectId: q.sourcingProjectId });
      return after;
    });
  }

  // tests -------------------------------------------------------------------

  async addTest(actor: Actor, id: string, dto: TestDto) {
    return this.db.tx(async (tx) => {
      const q = await this.lockQualification(tx, id);
      this.assertOpen(q);
      const t = await tx.testRecord.create({ data: { ...dto, isRequired: dto.isRequired ?? true, qualificationId: id, createdById: actor.userId } });
      await this.audit.record({ eventType: "qualification.test_planned", entityType: "PRODUCT_QUALIFICATION", entityId: id, entityLabel: q.number, metadata: { testId: t.id, name: t.name, testType: t.testType, isRequired: t.isRequired } }, tx);
      return t;
    });
  }

  private async documentInScope(tx: Tx, documentId: string | undefined, supplierId: string) {
    if (!documentId) return;
    const d = await tx.documentRecord.findFirst({ where: { id: documentId, OR: [{ supplierId }, { supplierId: null }] } });
    if (!d) throw new BusinessRuleError("The evidence document was not found for this supplier");
  }

  async recordTestResult(actor: Actor, testId: string, dto: TestResultDto) {
    return this.db.tx(async (tx) => {
      const t = await tx.testRecord.findUnique({ where: { id: testId } });
      if (!t) throw new NotFoundError("Test");
      const q = await this.lockQualification(tx, t.qualificationId);
      this.assertOpen(q);
      if (t.status === "ACCEPTED") throw new ConflictError("An accepted test result cannot be changed", "CONTROLLED_RECORD");
      await this.documentInScope(tx, dto.documentId, q.supplierId);
      const after = await tx.testRecord.update({
        where: { id: testId },
        data: { outcome: dto.outcome, resultSummary: dto.resultSummary, testedAt: toDate(dto.testedAt) ?? new Date(), laboratory: dto.laboratory ?? null, documentId: dto.documentId ?? null, status: "SUBMITTED", reviewedAt: null, reviewedById: null, reviewComment: null, version: { increment: 1 } },
      });
      await this.audit.record({ eventType: "qualification.test_result_recorded", entityType: "PRODUCT_QUALIFICATION", entityId: q.id, entityLabel: q.number, metadata: { testId, outcome: dto.outcome, documentId: dto.documentId } }, tx);
      return after;
    });
  }

  async reviewTest(actor: Actor, testId: string, decision: "ACCEPTED" | "REJECTED", comment: string) {
    return this.db.tx(async (tx) => {
      const t = await tx.testRecord.findUnique({ where: { id: testId } });
      if (!t) throw new NotFoundError("Test");
      const q = await this.lockQualification(tx, t.qualificationId);
      this.assertOpen(q);
      if (t.status !== "SUBMITTED") throw new InvalidTransitionError("Test result", t.status, "reviewed");
      if (decision === "ACCEPTED" && t.outcome === "FAIL") throw new BusinessRuleError("A failed test cannot be accepted; record a new result or a deviation");
      const after = await tx.testRecord.update({ where: { id: testId }, data: { status: decision, reviewedById: actor.userId, reviewedAt: new Date(), reviewComment: comment, version: { increment: 1 } } });
      await this.audit.record({ eventType: `qualification.test_${decision.toLowerCase()}`, entityType: "PRODUCT_QUALIFICATION", entityId: q.id, entityLabel: q.number, reason: comment, metadata: { testId, outcome: t.outcome } }, tx);
      await this.activity.record(tx, { entityType: "PRODUCT_QUALIFICATION", entityId: q.id, entityLabel: q.number, verb: `test_${decision.toLowerCase()}`, summary: `Test "${t.name}" (${t.outcome}) ${decision.toLowerCase()}: ${comment}`, supplierId: q.supplierId, projectId: q.sourcingProjectId });
      return after;
    });
  }

  // first-article inspections -----------------------------------------------

  async addFai(actor: Actor, id: string, dto: FaiDto) {
    return this.db.tx(async (tx) => {
      const q = await this.lockQualification(tx, id);
      this.assertOpen(q);
      await this.documentInScope(tx, dto.documentId, q.supplierId);
      if (dto.nonconformingCount > dto.characteristicsInspected) throw new BusinessRuleError("Nonconforming characteristics cannot exceed inspected characteristics");
      if (dto.outcome === "PASS" && dto.nonconformingCount > 0) throw new BusinessRuleError("A passing FAI cannot have nonconforming characteristics (use CONDITIONAL with a deviation)");
      const number = await this.numbering.next(tx, "FIRST_ARTICLE");
      const fai = await tx.firstArticleInspection.create({
        data: { number, qualificationId: id, configurationRevisionId: q.configurationRevisionId, serialNumbers: dto.serialNumbers ?? null, inspectionDate: toDate(dto.inspectionDate) ?? null, characteristicsInspected: dto.characteristicsInspected, nonconformingCount: dto.nonconformingCount, outcome: dto.outcome, summary: dto.summary ?? null, documentId: dto.documentId ?? null, status: "SUBMITTED", createdById: actor.userId },
      });
      await this.audit.record({ eventType: "qualification.fai_recorded", entityType: "PRODUCT_QUALIFICATION", entityId: id, entityLabel: q.number, metadata: { faiId: fai.id, number, outcome: dto.outcome } }, tx);
      return fai;
    });
  }

  async reviewFai(actor: Actor, faiId: string, decision: "ACCEPTED" | "REJECTED", comment: string) {
    return this.db.tx(async (tx) => {
      const fai = await tx.firstArticleInspection.findUnique({ where: { id: faiId } });
      if (!fai) throw new NotFoundError("First article inspection");
      const q = await this.lockQualification(tx, fai.qualificationId);
      this.assertOpen(q);
      if (fai.status !== "SUBMITTED") throw new InvalidTransitionError("FAI", fai.status, "reviewed");
      if (decision === "ACCEPTED" && fai.outcome === "FAIL") throw new BusinessRuleError("A failed FAI cannot be accepted");
      const after = await tx.firstArticleInspection.update({ where: { id: faiId }, data: { status: decision, reviewedById: actor.userId, reviewedAt: new Date(), reviewComment: comment, version: { increment: 1 } } });
      await this.audit.record({ eventType: `qualification.fai_${decision.toLowerCase()}`, entityType: "PRODUCT_QUALIFICATION", entityId: q.id, entityLabel: q.number, reason: comment, metadata: { faiId, number: fai.number } }, tx);
      await this.activity.record(tx, { entityType: "PRODUCT_QUALIFICATION", entityId: q.id, entityLabel: q.number, verb: `fai_${decision.toLowerCase()}`, summary: `FAI ${fai.number} (${fai.outcome}) ${decision.toLowerCase()}`, supplierId: q.supplierId, projectId: q.sourcingProjectId });
      return after;
    });
  }

  async addInspectionResult(actor: Actor, id: string, dto: InspectionResultDto) {
    return this.db.tx(async (tx) => {
      const q = await this.lockQualification(tx, id);
      this.assertOpen(q);
      if (dto.characteristicId && !(await tx.criticalCharacteristic.findFirst({ where: { id: dto.characteristicId, configurationRevisionId: q.configurationRevisionId } }))) {
        throw new BusinessRuleError("The characteristic does not belong to the configuration revision under qualification");
      }
      if (dto.firstArticleId && !(await tx.firstArticleInspection.findFirst({ where: { id: dto.firstArticleId, qualificationId: id } }))) throw new BusinessRuleError("The FAI does not belong to this qualification");
      const r = await tx.inspectionResult.create({ data: { ...dto, qualificationId: id, inspectedById: actor.userId } });
      await this.audit.record({ eventType: "qualification.inspection_recorded", entityType: "PRODUCT_QUALIFICATION", entityId: id, entityLabel: q.number, metadata: { resultId: r.id, characteristicId: dto.characteristicId, outcome: dto.outcome } }, tx);
      return r;
    });
  }

  // ------------------------------------------------------------------ approval gate

  private requirementScope(q: { sourcingProjectId: string | null; changeRequestId: string | null; id: string }): Prisma.RequiredDocumentWhereInput {
    return {
      OR: [
        ...(q.sourcingProjectId ? [{ projectId: q.sourcingProjectId }] : []),
        ...(q.changeRequestId ? [{ changeRequestId: q.changeRequestId }] : []),
        { qualificationId: q.id },
      ],
      // The approval record (VAL-11) is generated at approval.
      documentType: { code: { not: "VAL-11" } },
    };
  }

  /**
   * Evaluates every product-approval condition. Used for display, at submission, and again inside the final approval
   * transaction (so approval cannot be forced by changing status fields).
   */
  async evaluateGate(tx: Tx, qualificationId: string): Promise<GateCheck[]> {
    const q = await tx.productQualification.findUniqueOrThrow({
      where: { id: qualificationId },
      include: {
        supplier: true,
        supplierProduct: { include: { site: true } },
        configurationRevision: { include: { baseline: true, requirements: true, configuration: true } },
        tests: true,
        firstArticles: { orderBy: { createdAt: "desc" } },
      },
    });
    const rev = q.configurationRevision;
    const checks: GateCheck[] = [];

    const baselineProblems: string[] = [];
    if (!rev.baseline) baselineProblems.push("No engineering baseline / product definition recorded");
    else if (rev.baseline.status !== "ACCEPTED") baselineProblems.push(`Baseline (${rev.baseline.baselineType}) is ${rev.baseline.status}; engineering acceptance is required`);
    else if (rev.baseline.baselineType === "PRELIMINARY_REVERSE_ENGINEERED") baselineProblems.push("A preliminary reverse-engineered definition must be released as a controlled design");
    checks.push({ key: "baseline", label: "Controlled design or supplier product baseline exists", passed: baselineProblems.length === 0, details: baselineProblems });

    if (rev.baseline?.baselineType === "SUPPLIER_BASELINE_WITH_DELTA" || rev.requirements.length) {
      const deltaProblems: string[] = [];
      if (rev.baseline?.baselineType === "SUPPLIER_BASELINE_WITH_DELTA" && !rev.requirements.length) deltaProblems.push("No customer-specific (delta) requirements recorded");
      for (const r of rev.requirements) {
        if (r.ackStatus !== "ACKNOWLEDGED") deltaProblems.push(`${r.code} ${r.title}: supplier acknowledgment ${r.ackStatus}`);
        if (r.verificationStatus !== "VERIFIED" && r.verificationStatus !== "WAIVED") deltaProblems.push(`${r.code} ${r.title}: verification ${r.verificationStatus}`);
      }
      checks.push({ key: "delta", label: "Customer-specific requirements acknowledged by the supplier and verified", passed: deltaProblems.length === 0, details: deltaProblems });
    }

    const configProblems: string[] = [];
    if (!["DRAFT", "PROPOSED", "IN_REVIEW"].includes(rev.status)) configProblems.push(`Configuration revision ${rev.revisionLabel} is ${rev.status}`);
    const site = q.supplierProduct.site;
    if (["SUSPENDED", "INACTIVE"].includes(site.status)) configProblems.push(`Manufacturing site ${site.siteCode} is ${site.status}`);
    checks.push({
      key: "configuration",
      label: "Approved configuration and manufacturing site identified",
      passed: configProblems.length === 0,
      details: configProblems.length ? configProblems : [`${rev.configuration.configCode} rev ${rev.revisionLabel} @ ${site.siteCode} ${site.name}`],
    });

    checks.push({
      key: "supplier",
      label: "Supplier qualification status permits product approval",
      passed: ["APPROVED", "CONDITIONALLY_APPROVED"].includes(q.supplier.status),
      details: ["APPROVED", "CONDITIONALLY_APPROVED"].includes(q.supplier.status) ? [] : [`Supplier status is ${q.supplier.status}; complete supplier qualification first`],
    });

    const reqs = await tx.requiredDocument.findMany({ where: this.requirementScope(q), include: { documentType: { select: { code: true, name: true } } } });
    const missing = reqs.filter((r) => r.level !== "NOT_APPLICABLE" && !["ACCEPTED", "WAIVED", "NOT_APPLICABLE"].includes(r.status));
    checks.push({
      key: "documentation",
      label: "Required documentation complete (accepted or formally waived)",
      passed: missing.length === 0,
      details: missing.map((r) => `${r.documentType.code} ${r.documentType.name} (${r.level.toLowerCase()}): ${r.status}`),
    });

    const testProblems: string[] = [];
    for (const t of q.tests.filter((t) => t.isRequired)) {
      if (t.status !== "ACCEPTED") testProblems.push(`Test "${t.name}": ${t.status}`);
      else if (t.outcome === "FAIL") testProblems.push(`Test "${t.name}" failed`);
    }
    const faiRequired = reqs.some((r) => r.documentType.code === "VAL-02" && r.status !== "WAIVED" && r.status !== "NOT_APPLICABLE") || q.firstArticles.length > 0;
    if (faiRequired) {
      const latest = q.firstArticles[0];
      if (!latest) testProblems.push("No first-article inspection recorded");
      else if (latest.status !== "ACCEPTED") testProblems.push(`Latest FAI ${latest.number} is ${latest.status}`);
    }
    checks.push({ key: "validation", label: "Required testing and validation accepted", passed: testProblems.length === 0, details: testProblems });

    const ncrs = await tx.nonconformance.findMany({
      where: { blocksApproval: true, status: { in: [...OPEN_NCR] }, OR: [{ qualificationId: q.id }, { configurationRevisionId: rev.id }] },
      select: { number: true, status: true, severity: true },
    });
    const deviations = await tx.deviation.findMany({
      where: { blocksApproval: true, status: { in: ["DRAFT", "SUBMITTED"] }, OR: [{ qualificationId: q.id }, { configurationRevisionId: rev.id }] },
      select: { number: true, status: true },
    });
    checks.push({
      key: "nonconformances",
      label: "Blocking nonconformances and deviations resolved or formally dispositioned",
      passed: ncrs.length === 0 && deviations.length === 0,
      details: [...ncrs.map((n) => `NCR ${n.number} (${n.severity}) is ${n.status}`), ...deviations.map((d) => `Deviation ${d.number} is ${d.status}`)],
    });
    return checks;
  }

  private snapshotRef(checks: GateCheck[], revVersion: number, docRevisionIds: string[]) {
    return createHash("sha256").update(canonicalJson({ revVersion, docs: [...docRevisionIds].sort(), checks: checks.map((c) => c.key) })).digest("hex");
  }

  async submitForApproval(actor: Actor, id: string, expectedVersion: number) {
    return this.db.tx(async (tx, after) => {
      const q = await this.lockQualification(tx, id, expectedVersion);
      if (q.changeRequestId) throw new BusinessRuleError("Change requalifications are approved through the change request workflow");
      if (!["DOCUMENTATION_PENDING", "EVALUATION", "VALIDATION"].includes(q.status)) throw new InvalidTransitionError("Qualification", q.status, "submitted for approval");
      await this.db.lockRow(tx, "configuration_revisions", q.configurationRevisionId);
      const checks = await this.evaluateGate(tx, id);
      if (checks.some((c) => !c.passed)) throw new ApprovalGateError(checks);
      const rev = await tx.configurationRevision.update({ where: { id: q.configurationRevisionId }, data: { status: "IN_REVIEW", version: { increment: 1 } } });
      const reqs = await tx.requiredDocument.findMany({ where: { ...this.requirementScope(q), status: "ACCEPTED" }, select: { acceptedRevisionId: true } });
      await tx.productQualification.update({ where: { id }, data: { status: "APPROVAL_REVIEW", version: { increment: 1 } } });
      if (q.sourcingProjectId) await tx.sourcingProject.update({ where: { id: q.sourcingProjectId }, data: { stage: "APPROVAL", version: { increment: 1 } } });
      const instance = await this.workflow.start(tx, after, {
        definitionKey: q.workflowKey,
        subjectType: "PRODUCT_QUALIFICATION",
        subjectId: id,
        subjectLabel: `${q.number} ${q.title}`,
        subjectVersionRef: this.snapshotRef(checks, rev.version, reqs.map((r) => r.acceptedRevisionId!).filter(Boolean)),
        link: `/qualifications/${id}`,
        context: { riskLevel: q.riskLevel, pathway: q.pathway },
        startedById: actor.userId,
      });
      await tx.productQualification.update({ where: { id }, data: { workflowInstanceId: instance.id } });
      await this.audit.record({ eventType: "qualification.submitted_for_approval", entityType: "PRODUCT_QUALIFICATION", entityId: id, entityLabel: q.number, metadata: { workflowKey: q.workflowKey, gate: checks.map((c) => ({ key: c.key, passed: c.passed })) } }, tx);
      await this.activity.record(tx, { entityType: "PRODUCT_QUALIFICATION", entityId: id, entityLabel: q.number, verb: "submitted", summary: `Submitted for product approval (${q.workflowKey}); all approval gate checks passed`, supplierId: q.supplierId, projectId: q.sourcingProjectId });
      return tx.productQualification.findUniqueOrThrow({ where: { id } });
    });
  }

  // ------------------------------------------------------------------ approval finalization

  async approvalsOf(tx: Tx, instanceId: string): Promise<ApprovalRecord[]> {
    const steps = await tx.workflowStep.findMany({ where: { instanceId }, orderBy: { stepOrder: "asc" }, include: { assignments: { where: { status: "APPROVED" }, include: { decidedBy: { select: { displayName: true } } } } } });
    return steps.flatMap((s) =>
      s.assignments.map((a) => ({ step: s.name, decision: a.status, decidedById: a.decidedById, decidedBy: a.decidedBy?.displayName ?? null, decidedAt: a.decidedAt?.toISOString() ?? null, subjectRef: a.decidedSubjectRef })),
    );
  }

  /**
   * Finalizes a product approval: re-validates the gate, freezes the release snapshot (approval package), authorizes
   * the configuration revision (superseding the previously approved revision, which is retained), records the explicit
   * approved supplier-product-configuration-site record and generates the released PSAR (VAL-11).
   */
  async finalizeApproval(tx: Tx, after: AfterCommit, qualificationId: string, approvals: ApprovalRecord[], opts: { changeRequestId?: string } = {}) {
    await this.db.lockRow(tx, "product_qualifications", qualificationId);
    const qBefore = await tx.productQualification.findUniqueOrThrow({ where: { id: qualificationId } });
    await this.db.lockRow(tx, "configuration_revisions", qBefore.configurationRevisionId);
    const checks = await this.evaluateGate(tx, qualificationId);
    if (checks.some((c) => !c.passed)) throw new ApprovalGateError(checks);
    const actorId = RequestContext.get()?.actor?.userId ?? null;
    const now = new Date();
    const q = await tx.productQualification.findUniqueOrThrow({
      where: { id: qualificationId },
      include: {
        supplier: true,
        supplierProduct: { include: { internalPart: true, supplierPart: true, site: true } },
        configurationRevision: { include: { baseline: true, requirements: true, characteristics: true, configuration: { include: { baseConfiguration: true } } } },
        tests: true,
        firstArticles: true,
        deviations: true,
        nonconformances: true,
      },
    });
    const rev = q.configurationRevision;
    const config = rev.configuration;
    const reqs = await tx.requiredDocument.findMany({
      where: this.requirementScope(q),
      include: { documentType: { select: { code: true, name: true } }, acceptedRevision: { include: { document: { select: { id: true, docNumber: true, title: true } } } } },
    });
    const waivers = reqs.filter((r) => r.status === "WAIVED");
    const accepted = reqs.filter((r) => r.status === "ACCEPTED" && r.acceptedRevision);
    const snapshot = {
      qualification: { id: q.id, number: q.number, pathway: q.pathway, riskLevel: q.riskLevel, workflowKey: q.workflowKey, changeRequestId: opts.changeRequestId ?? q.changeRequestId },
      supplier: { id: q.supplier.id, supplierNumber: q.supplier.supplierNumber, name: q.supplier.name, status: q.supplier.status },
      site: { id: q.supplierProduct.site.id, siteCode: q.supplierProduct.site.siteCode, name: q.supplierProduct.site.name, country: q.supplierProduct.site.country },
      internalPart: { id: q.supplierProduct.internalPart.id, partNumber: q.supplierProduct.internalPart.partNumber, description: q.supplierProduct.internalPart.description, criticality: q.supplierProduct.internalPart.criticality },
      supplierPart: { id: q.supplierProduct.supplierPart.id, supplierPartNumber: q.supplierProduct.supplierPart.supplierPartNumber },
      configuration: { id: config.id, configCode: config.configCode, name: config.name, type: config.configurationType, customPartNumber: config.customPartNumber, baseConfiguration: config.baseConfiguration ? { id: config.baseConfiguration.id, configCode: config.baseConfiguration.configCode } : null },
      configurationRevision: {
        id: rev.id,
        revisionLabel: rev.revisionLabel,
        version: rev.version,
        baseline: rev.baseline,
        requirements: rev.requirements.map((r) => ({ code: r.code, category: r.category, title: r.title, baselineValue: r.baselineValue, requiredValue: r.requiredValue, acceptanceCriteria: r.acceptanceCriteria, ackStatus: r.ackStatus, ackByName: r.ackByName, verificationStatus: r.verificationStatus })),
        characteristics: rev.characteristics.map((c) => ({ charNumber: c.charNumber, name: c.name, classification: c.classification, nominal: c.nominal?.toString() ?? null, tolerancePlus: c.tolerancePlus?.toString() ?? null, toleranceMinus: c.toleranceMinus?.toString() ?? null, unit: c.unit })),
      },
      documents: accepted.map((r) => ({ requirementId: r.id, documentTypeCode: r.documentType.code, documentId: r.acceptedRevision!.document.id, docNumber: r.acceptedRevision!.document.docNumber, revisionId: r.acceptedRevision!.id, revisionLabel: r.acceptedRevision!.revisionLabel, status: r.acceptedRevision!.status, contentHash: r.acceptedRevision!.contentHash })),
      waivers: waivers.map((w) => ({ documentTypeCode: w.documentType.code, level: w.level, justification: w.waiverJustification, waivedById: w.waivedById, waivedAt: w.waivedAt?.toISOString() ?? null })),
      tests: q.tests.map((t) => ({ name: t.name, testType: t.testType, status: t.status, outcome: t.outcome, documentId: t.documentId })),
      firstArticles: q.firstArticles.map((f) => ({ number: f.number, status: f.status, outcome: f.outcome, documentId: f.documentId })),
      deviations: q.deviations.map((d) => ({ number: d.number, status: d.status, type: d.type })),
      nonconformances: q.nonconformances.map((n) => ({ number: n.number, status: n.status, disposition: n.disposition })),
      approvals,
      gate: checks.map((c) => ({ key: c.key, passed: c.passed })),
      approvedAt: now.toISOString(),
    };
    // Normalize through JSON so the stored snapshot and its hash are computed from identical data (dates as ISO strings).
    const frozen = JSON.parse(JSON.stringify(snapshot)) as Prisma.JsonObject;
    const snapshotHash = createHash("sha256").update(canonicalJson(frozen)).digest("hex");
    const packageNumber = await this.numbering.next(tx, "APPROVAL_PACKAGE");
    const pkg = await tx.approvalPackage.create({
      data: {
        number: packageNumber,
        qualificationId: q.id,
        configurationRevisionId: rev.id,
        snapshot: frozen as Prisma.InputJsonValue,
        snapshotHash,
        createdById: actorId ?? q.createdById,
        items: { create: [...new Map(accepted.map((r) => [r.acceptedRevision!.id, r])).values()].map((r) => ({ documentRevisionId: r.acceptedRevision!.id, documentTypeCode: r.documentType.code, contentHash: r.acceptedRevision!.contentHash })) },
      },
    });

    // Authorize the configuration revision; keep the previously approved revision as SUPERSEDED.
    const previousId = config.currentApprovedRevisionId;
    if (previousId && previousId !== rev.id) {
      await tx.configurationRevision.update({ where: { id: previousId }, data: { status: "SUPERSEDED", supersededAt: now, supersededByRevisionId: rev.id, version: { increment: 1 } } });
      await tx.productApproval.updateMany({ where: { configurationRevisionId: previousId, status: { in: ["ACTIVE", "SUSPENDED"] } }, data: { status: "SUPERSEDED", supersededAt: now, supersededByChangeRequestId: opts.changeRequestId ?? null } });
    }
    await tx.configurationRevision.update({ where: { id: rev.id }, data: { status: "APPROVED", approvedAt: now, approvedById: actorId, version: { increment: 1 } } });
    await tx.productConfiguration.update({ where: { id: config.id }, data: { currentApprovedRevisionId: rev.id } });
    const conditional = !!q.approvalRestrictions?.trim() || q.supplier.status === "CONDITIONALLY_APPROVED" || q.deviations.some((d) => d.status === "APPROVED");
    const approvalNumber = await this.numbering.next(tx, "PRODUCT_APPROVAL");
    const approval = await tx.productApproval.create({
      data: {
        number: approvalNumber,
        internalPartId: q.supplierProduct.internalPartId,
        supplierProductId: q.supplierProductId,
        supplierId: q.supplierId,
        siteId: q.supplierProduct.siteId,
        configurationRevisionId: rev.id,
        qualificationId: q.id,
        approvalPackageId: pkg.id,
        restrictions: q.approvalRestrictions,
        approvedById: actorId ?? q.createdById,
        approvedAt: now,
        effectiveFrom: now,
      },
    });
    await tx.supplierProduct.update({ where: { id: q.supplierProductId }, data: { status: conditional ? "CONDITIONALLY_APPROVED" : "APPROVED", approvedAt: now, statusReason: `Approved by ${approvalNumber}`, version: { increment: 1 } } });
    await tx.productQualification.update({ where: { id: q.id }, data: { status: "APPROVED", decidedAt: now, decidedById: actorId, version: { increment: 1 } } });
    if (q.sourcingProjectId) await tx.sourcingProject.update({ where: { id: q.sourcingProjectId }, data: { status: "APPROVED", stage: "PRODUCTION", approvedAt: now, version: { increment: 1 } } });

    // System-generated, released Product & Supplier Approval Record (VAL-11).
    const psarType = await tx.documentType.findUniqueOrThrow({ where: { code: "VAL-11" } });
    const users = await tx.user.findMany({ where: { id: { in: approvals.map((a) => a.decidedById).filter((x): x is string => !!x) } }, select: { id: true, displayName: true } });
    const creator: Actor = {
      userId: actorId ?? q.createdById,
      email: "",
      displayName: "System",
      userType: "INTERNAL",
      timezone: "UTC",
      sessionId: "",
      organizationId: (await tx.organization.findUniqueOrThrow({ where: { code: "INTERNAL" } })).id,
      organizationType: "INTERNAL",
      organizationName: "",
      supplierId: null,
      roles: [],
      // Write plus read access to the records the generated approval record links to.
      permissions: new Set(["document:write", "document:read", "qualification:read", "product:read", "supplier:read"]),
    };
    const psar = await this.documents.create(
      creator,
      {
        documentTypeId: psarType.id,
        title: `PSAR ${approvalNumber} - ${q.supplierProduct.internalPart.partNumber} ${config.configCode} rev ${rev.revisionLabel}`,
        supplierId: q.supplierId,
        submissionMethod: "NATIVE_FORM",
        formData: {
          approvalNumber,
          internalPartNumber: q.supplierProduct.internalPart.partNumber,
          supplierName: q.supplier.name,
          supplierPartNumber: config.customPartNumber ?? q.supplierProduct.supplierPart.supplierPartNumber,
          manufacturingSite: `${q.supplierProduct.site.siteCode} ${q.supplierProduct.site.name}`,
          configurationRef: `${config.configCode} rev ${rev.revisionLabel}`,
          qualificationNumber: q.number,
          approvedAt: now.toISOString().slice(0, 10),
          restrictions: q.approvalRestrictions ?? "",
          documents: snapshot.documents.map((d) => ({ documentType: d.documentTypeCode, docNumber: d.docNumber, revision: d.revisionLabel, contentHash: d.contentHash ?? "" })),
          approvers: approvals.map((a) => ({ step: a.step, approver: users.find((u) => u.id === a.decidedById)?.displayName ?? a.decidedBy ?? "", decidedAt: a.decidedAt ?? "" })),
          snapshotHash,
        },
        links: [
          { entityType: "PRODUCT_QUALIFICATION", entityId: q.id, linkRole: "APPROVAL_RECORD" },
          { entityType: "CONFIGURATION_REVISION", entityId: rev.id, linkRole: "APPROVAL_RECORD" },
          { entityType: "INTERNAL_PART", entityId: q.supplierProduct.internalPartId, linkRole: "APPROVAL_RECORD" },
          { entityType: "SUPPLIER", entityId: q.supplierId, linkRole: "APPROVAL_RECORD" },
        ],
      },
      tx,
    );
    const psarHash = createHash("sha256").update(canonicalJson({ snapshotHash, approvalNumber })).digest("hex");
    await tx.documentRevision.update({ where: { id: psar.revision.id }, data: { status: "RELEASED", contentHash: psarHash, submittedAt: now, approvedAt: now, releasedAt: now, releasedById: actorId, changeSummary: `Generated at approval ${approvalNumber}` } });
    await tx.documentRecord.update({ where: { id: psar.document.id }, data: { status: "RELEASED", releasedRevisionId: psar.revision.id } });
    await tx.documentRelease.create({ data: { releaseNumber: await this.numbering.next(tx, "DOCUMENT_RELEASE"), revisionId: psar.revision.id, releasedById: actorId ?? q.createdById, effectiveDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), releaseNotes: `System-generated approval record for ${q.number}` } });

    await this.audit.record(
      {
        eventType: "product.approved",
        entityType: "PRODUCT_QUALIFICATION",
        entityId: q.id,
        entityLabel: q.number,
        changes: { configurationRevisionStatus: { before: rev.status, after: "APPROVED" }, supplierProductStatus: { before: q.supplierProduct.status, after: conditional ? "CONDITIONALLY_APPROVED" : "APPROVED" } },
        metadata: { approvalNumber, approvalPackage: packageNumber, snapshotHash, configurationRevisionId: rev.id, supersededRevisionId: previousId !== rev.id ? previousId : null, psarDocumentId: psar.document.id },
      },
      tx,
    );
    await this.activity.record(tx, {
      entityType: "PRODUCT_QUALIFICATION",
      entityId: q.id,
      entityLabel: q.number,
      verb: "approved",
      summary: `Product approved: ${config.configCode} rev ${rev.revisionLabel} at ${q.supplierProduct.site.siteCode} (${approvalNumber}, package ${packageNumber})`,
      supplierId: q.supplierId,
      internalPartId: q.supplierProduct.internalPartId,
      projectId: q.sourcingProjectId,
    });
    await this.outbox.publish(tx, "product.approved", "SUPPLIER_PRODUCT", q.supplierProductId, {
      approvalNumber,
      internalPartNumber: q.supplierProduct.internalPart.partNumber,
      supplierNumber: q.supplier.supplierNumber,
      supplierPartNumber: config.customPartNumber ?? q.supplierProduct.supplierPart.supplierPartNumber,
      siteCode: q.supplierProduct.site.siteCode,
      configuration: `${config.configCode} rev ${rev.revisionLabel}`,
      conditional,
    });
    await this.notifications.notify(tx, after, { eventType: "product.approved", title: `Product approved: ${q.supplierProduct.internalPart.partNumber} from ${q.supplier.name} (${approvalNumber})`, entityType: "PRODUCT_QUALIFICATION", entityId: q.id, link: `/qualifications/${q.id}`, roleKeys: ["SOURCING", "SUPPLIER_QUALITY"] });
    return approval;
  }

  async onApproved(tx: Tx, after: AfterCommit, instance: WorkflowInstance): Promise<void> {
    await this.finalizeApproval(tx, after, instance.subjectId, await this.approvalsOf(tx, instance.id));
  }

  async onRejected(tx: Tx, _after: AfterCommit, instance: WorkflowInstance, comment: string): Promise<void> {
    const q = await tx.productQualification.update({ where: { id: instance.subjectId }, data: { status: "REJECTED", decisionComment: comment, decidedAt: new Date(), decidedById: RequestContext.get()?.actor?.userId ?? null, version: { increment: 1 } } });
    await tx.configurationRevision.update({ where: { id: q.configurationRevisionId }, data: { status: "DRAFT", version: { increment: 1 } } });
    if (q.sourcingProjectId) await tx.sourcingProject.update({ where: { id: q.sourcingProjectId }, data: { status: "IN_PROGRESS", stage: "VALIDATION", version: { increment: 1 } } });
    await this.activity.record(tx, { entityType: "PRODUCT_QUALIFICATION", entityId: q.id, entityLabel: q.number, verb: "rejected", summary: `Product approval rejected: ${comment}`, supplierId: q.supplierId, projectId: q.sourcingProjectId });
  }

  async onInfoRequested(tx: Tx, _after: AfterCommit, instance: WorkflowInstance, comment: string): Promise<void> {
    const q = await tx.productQualification.update({ where: { id: instance.subjectId }, data: { status: "VALIDATION", decisionComment: comment, version: { increment: 1 } } });
    await tx.configurationRevision.update({ where: { id: q.configurationRevisionId }, data: { status: "DRAFT", version: { increment: 1 } } });
    if (q.sourcingProjectId) await tx.sourcingProject.update({ where: { id: q.sourcingProjectId }, data: { stage: "VALIDATION", version: { increment: 1 } } });
    await this.activity.record(tx, { entityType: "PRODUCT_QUALIFICATION", entityId: q.id, entityLabel: q.number, verb: "returned", summary: `Returned for more information: ${comment}`, supplierId: q.supplierId, projectId: q.sourcingProjectId });
  }

  async approvalPackage(actor: Actor, id: string) {
    AccessScope.of(actor).requireInternal();
    const pkg = await this.db.client.approvalPackage.findUnique({ where: { qualificationId: id }, include: { items: true } });
    if (!pkg) throw new NotFoundError("Approval package");
    const recomputed = createHash("sha256").update(canonicalJson(pkg.snapshot)).digest("hex");
    return { ...pkg, integrityVerified: recomputed === pkg.snapshotHash };
  }
}
