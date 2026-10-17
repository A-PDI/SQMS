import { createHash } from "node:crypto";
import { Injectable, OnModuleInit } from "@nestjs/common";
import type { DeviationStatus, DeviationType, Prisma, WorkflowInstance } from "@sqms/db";
import { canonicalJson } from "@sqms/shared";
import type { Actor } from "../../common/auth/actor";
import { AccessScope } from "../../common/auth/access-scope";
import { ActivityService } from "../../common/audit/activity.service";
import { AuditService, diffControlled } from "../../common/audit/audit.service";
import { RequestContext } from "../../common/context/request-context";
import { DbService, type AfterCommit, type Tx } from "../../common/db/db.service";
import { BusinessRuleError, InvalidTransitionError, NotFoundError, StaleVersionError } from "../../common/errors/app-errors";
import { toDate } from "../../common/http/dto-helpers";
import { pageArgs, sortArg, trimQ, type Page } from "../../common/http/pagination";
import { NotificationService } from "../../common/services/notification.service";
import { NumberingService } from "../../common/services/numbering.service";
import { OutboxService } from "../../common/services/outbox.service";
import { WorkflowService, type WorkflowSubjectHandler } from "../workflow/workflow.service";
import type { CreateDeviationDto, DeviationListQuery, UpdateDeviationDto } from "./quality.dto";

const INCLUDE = {
  supplier: { select: { id: true, name: true, supplierNumber: true } },
  supplierProduct: { select: { id: true, internalPart: { select: { id: true, partNumber: true } }, supplierPart: { select: { supplierPartNumber: true } }, site: { select: { siteCode: true } } } },
  configurationRevision: { select: { id: true, revisionLabel: true, configuration: { select: { configCode: true } } } },
  qualification: { select: { id: true, number: true, status: true } },
  ncr: { select: { id: true, number: true, status: true } },
} satisfies Prisma.DeviationInclude;

@Injectable()
export class DeviationsService implements OnModuleInit, WorkflowSubjectHandler {
  readonly subjectType = "DEVIATION" as const;

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly numbering: NumberingService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationService,
    private readonly workflow: WorkflowService,
  ) {}

  onModuleInit(): void {
    this.workflow.registerHandler(this);
  }

  private where(actor: Actor, q: DeviationListQuery): Prisma.DeviationWhereInput {
    const scope = AccessScope.of(actor);
    const term = trimQ(q.q);
    return {
      ...(scope.isInternal ? {} : { ...scope.supplierWhere(), supplierVisible: true }),
      ...(q.status?.length ? { status: { in: q.status as DeviationStatus[] } } : {}),
      ...(q.type ? { type: q.type as DeviationType } : {}),
      ...(q.supplierId && scope.isInternal ? { supplierId: q.supplierId } : {}),
      ...(q.ncrId ? { ncrId: q.ncrId } : {}),
      ...(term ? { OR: [{ number: { contains: term } }, { title: { contains: term } }] } : {}),
    };
  }

  async list(actor: Actor, q: DeviationListQuery): Promise<Page<unknown>> {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where = this.where(actor, q);
    const [total, items] = await Promise.all([
      this.db.client.deviation.count({ where }),
      this.db.client.deviation.findMany({ where, skip, take, orderBy: sortArg(q, ["number", "title", "status", "endDate", "createdAt", "updatedAt"] as const, "updatedAt"), include: INCLUDE }),
    ]);
    return { total, page, pageSize, items };
  }

  async get(actor: Actor, id: string) {
    const scope = AccessScope.of(actor);
    const d = await this.db.client.deviation.findUnique({ where: { id }, include: INCLUDE });
    if (!d || (!scope.isInternal && (!d.supplierVisible || d.supplierId !== scope.supplierId))) throw new NotFoundError("Deviation");
    return d;
  }

  /** Resolves the supplier from the referenced records; every reference must agree (client-supplied ids are not trusted). */
  private async resolveSupplier(tx: Tx, dto: Pick<CreateDeviationDto, "supplierProductId" | "configurationRevisionId" | "qualificationId" | "ncrId">) {
    const owners: { ref: string; supplierId: string }[] = [];
    if (dto.supplierProductId) {
      const sp = await tx.supplierProduct.findUnique({ where: { id: dto.supplierProductId } });
      if (!sp) throw new NotFoundError("Supplier product");
      owners.push({ ref: "supplier product", supplierId: sp.supplierId });
    }
    if (dto.configurationRevisionId) {
      const rev = await tx.configurationRevision.findUnique({ where: { id: dto.configurationRevisionId }, include: { configuration: true } });
      if (!rev) throw new NotFoundError("Configuration revision");
      if (dto.supplierProductId && rev.configuration.supplierProductId !== dto.supplierProductId) throw new BusinessRuleError("The configuration revision does not belong to the supplier product");
      owners.push({ ref: "configuration revision", supplierId: rev.configuration.supplierId });
    }
    if (dto.qualificationId) {
      const q = await tx.productQualification.findUnique({ where: { id: dto.qualificationId } });
      if (!q) throw new NotFoundError("Product qualification");
      owners.push({ ref: "qualification", supplierId: q.supplierId });
    }
    if (dto.ncrId) {
      const n = await tx.nonconformance.findUnique({ where: { id: dto.ncrId } });
      if (!n) throw new NotFoundError("Nonconformance");
      if (!n.supplierId) throw new BusinessRuleError("Resolve the NCR supplier before requesting a supplier concession");
      owners.push({ ref: "NCR", supplierId: n.supplierId });
    }
    if (!owners.length) throw new BusinessRuleError("Reference the affected supplier product, configuration, qualification or NCR");
    const supplierId = owners[0].supplierId;
    if (owners.some((o) => o.supplierId !== supplierId)) throw new BusinessRuleError("The referenced records belong to different suppliers");
    return supplierId;
  }

  private checkDates(start?: Date | null, end?: Date | null) {
    if (start && end && end < start) throw new BusinessRuleError("The end date must be on or after the start date");
  }

  async create(actor: Actor, dto: CreateDeviationDto) {
    const scope = AccessScope.of(actor);
    return this.db.tx(async (tx) => {
      const supplierId = await this.resolveSupplier(tx, dto);
      scope.assertSupplier(supplierId, "Referenced record");
      const startDate = toDate(dto.startDate) ?? null;
      const endDate = toDate(dto.endDate) ?? null;
      this.checkDates(startDate, endDate);
      if (dto.type === "DEVIATION" && !endDate && !dto.quantityLimit) throw new BusinessRuleError("A temporary deviation must be limited by an end date or a quantity");
      const number = await this.numbering.next(tx, "DEVIATION");
      const d = await tx.deviation.create({
        data: {
          number,
          type: dto.type,
          title: dto.title,
          supplierId,
          supplierProductId: dto.supplierProductId ?? null,
          configurationRevisionId: dto.configurationRevisionId ?? null,
          qualificationId: dto.qualificationId ?? null,
          ncrId: dto.ncrId ?? null,
          description: dto.description,
          justification: dto.justification,
          riskAssessment: dto.riskAssessment ?? null,
          quantityLimit: dto.quantityLimit ?? null,
          lotNumbers: dto.lotNumbers ?? null,
          startDate,
          endDate,
          blocksApproval: dto.blocksApproval ?? true,
          createdById: actor.userId,
        },
      });
      await this.audit.record({ eventType: "deviation.created", entityType: "DEVIATION", entityId: d.id, entityLabel: number, metadata: { type: dto.type, ncrId: dto.ncrId, qualificationId: dto.qualificationId } }, tx);
      await this.activity.record(tx, { entityType: "DEVIATION", entityId: d.id, entityLabel: number, verb: "created", summary: `${dto.type === "CONCESSION" ? "Concession" : "Deviation"} ${number} requested: ${dto.title}`, visibility: "SUPPLIER", supplierId });
      return d;
    });
  }

  private async lock(tx: Tx, id: string, expectedVersion?: number) {
    await this.db.lockRow(tx, "deviations", id);
    const d = await tx.deviation.findUnique({ where: { id } });
    if (!d) throw new NotFoundError("Deviation");
    if (expectedVersion !== undefined && d.version !== expectedVersion) throw new StaleVersionError("Deviation");
    return d;
  }

  private assertScope(actor: Actor, d: { supplierId: string; supplierVisible: boolean }) {
    const scope = AccessScope.of(actor);
    if (!scope.isInternal && (!d.supplierVisible || d.supplierId !== scope.supplierId)) throw new NotFoundError("Deviation");
  }

  async update(actor: Actor, id: string, dto: UpdateDeviationDto) {
    const { expectedVersion, startDate, endDate, ...rest } = dto;
    return this.db.tx(async (tx) => {
      const before = await this.lock(tx, id, expectedVersion);
      this.assertScope(actor, before);
      if (before.status !== "DRAFT") throw new InvalidTransitionError("Deviation", before.status, "edited");
      const s = startDate !== undefined ? toDate(startDate) : before.startDate;
      const e = endDate !== undefined ? toDate(endDate) : before.endDate;
      this.checkDates(s, e);
      const after = await tx.deviation.update({ where: { id }, data: { ...rest, ...(startDate !== undefined ? { startDate: s } : {}), ...(endDate !== undefined ? { endDate: e } : {}), version: { increment: 1 } } });
      await this.audit.record({ eventType: "deviation.updated", entityType: "DEVIATION", entityId: id, entityLabel: before.number, changes: diffControlled(before, after, ["title", "description", "justification", "riskAssessment", "quantityLimit", "lotNumbers", "startDate", "endDate"]) }, tx);
      return after;
    });
  }

  async submit(actor: Actor, id: string, expectedVersion: number) {
    return this.db.tx(async (tx, after) => {
      const d = await this.lock(tx, id, expectedVersion);
      this.assertScope(actor, d);
      if (d.status !== "DRAFT") throw new InvalidTransitionError("Deviation", d.status, "submitted");
      await tx.deviation.update({ where: { id }, data: { status: "SUBMITTED", version: { increment: 1 } } });
      const instance = await this.workflow.start(tx, after, {
        definitionKey: "deviation-approval",
        subjectType: "DEVIATION",
        subjectId: id,
        subjectLabel: `${d.number} ${d.title}`,
        subjectVersionRef: createHash("sha256").update(canonicalJson({ description: d.description, justification: d.justification, quantityLimit: d.quantityLimit, lotNumbers: d.lotNumbers, startDate: d.startDate, endDate: d.endDate })).digest("hex"),
        link: `/quality/deviations/${id}`,
        startedById: actor.userId,
      });
      await tx.deviation.update({ where: { id }, data: { workflowInstanceId: instance.id } });
      await this.audit.record({ eventType: "deviation.submitted", entityType: "DEVIATION", entityId: id, entityLabel: d.number, changes: { status: { before: "DRAFT", after: "SUBMITTED" } } }, tx);
      await this.activity.record(tx, { entityType: "DEVIATION", entityId: id, entityLabel: d.number, verb: "submitted", summary: "Submitted for approval", visibility: "SUPPLIER", supplierId: d.supplierId });
      return tx.deviation.findUniqueOrThrow({ where: { id } });
    });
  }

  async onApproved(tx: Tx, after: AfterCommit, instance: WorkflowInstance): Promise<void> {
    const d = await tx.deviation.update({ where: { id: instance.subjectId }, data: { status: "APPROVED", decidedAt: new Date(), decidedById: RequestContext.get()?.actor?.userId ?? null, version: { increment: 1 } } });
    await this.activity.record(tx, { entityType: "DEVIATION", entityId: d.id, entityLabel: d.number, verb: "approved", summary: `${d.type === "CONCESSION" ? "Concession" : "Deviation"} approved${d.endDate ? ` until ${d.endDate.toISOString().slice(0, 10)}` : ""}${d.quantityLimit ? ` for up to ${d.quantityLimit} pcs` : ""}`, visibility: "SUPPLIER", supplierId: d.supplierId });
    await this.notifications.notify(tx, after, { eventType: "deviation.approved", title: `${d.number} approved: ${d.title}`, entityType: "DEVIATION", entityId: d.id, link: `/quality/deviations/${d.id}`, userIds: [d.createdById] });
    await this.outbox.publish(tx, "deviation.approved", "DEVIATION", d.id, { number: d.number, type: d.type, endDate: d.endDate?.toISOString().slice(0, 10) ?? null, quantityLimit: d.quantityLimit });
  }

  async onRejected(tx: Tx, after: AfterCommit, instance: WorkflowInstance, comment: string): Promise<void> {
    const d = await tx.deviation.update({ where: { id: instance.subjectId }, data: { status: "REJECTED", decisionComment: comment, decidedAt: new Date(), decidedById: RequestContext.get()?.actor?.userId ?? null, version: { increment: 1 } } });
    await this.activity.record(tx, { entityType: "DEVIATION", entityId: d.id, entityLabel: d.number, verb: "rejected", summary: `Rejected: ${comment}`, visibility: "SUPPLIER", supplierId: d.supplierId });
    await this.notifications.notify(tx, after, { eventType: "deviation.rejected", title: `${d.number} rejected`, body: comment, entityType: "DEVIATION", entityId: d.id, link: `/quality/deviations/${d.id}`, userIds: [d.createdById] });
  }

  async onInfoRequested(tx: Tx, after: AfterCommit, instance: WorkflowInstance, comment: string): Promise<void> {
    const d = await tx.deviation.update({ where: { id: instance.subjectId }, data: { status: "DRAFT", decisionComment: comment, version: { increment: 1 } } });
    await this.activity.record(tx, { entityType: "DEVIATION", entityId: d.id, entityLabel: d.number, verb: "returned", summary: `Returned for more information: ${comment}`, visibility: "SUPPLIER", supplierId: d.supplierId });
    await this.notifications.notify(tx, after, { eventType: "deviation.info_requested", title: `Information requested on ${d.number}`, body: comment, entityType: "DEVIATION", entityId: d.id, link: `/quality/deviations/${d.id}`, userIds: [d.createdById] });
  }

  async withdraw(actor: Actor, id: string, expectedVersion: number, reason: string) {
    return this.db.tx(async (tx) => {
      const d = await this.lock(tx, id, expectedVersion);
      this.assertScope(actor, d);
      if (d.status !== "DRAFT" && d.status !== "SUBMITTED") throw new InvalidTransitionError("Deviation", d.status, "withdrawn");
      await this.workflow.cancelForSubject(tx, "DEVIATION", id, reason);
      await tx.deviation.update({ where: { id }, data: { status: "WITHDRAWN", decisionComment: reason, version: { increment: 1 } } });
      await this.audit.record({ eventType: "deviation.withdrawn", entityType: "DEVIATION", entityId: id, entityLabel: d.number, changes: { status: { before: d.status, after: "WITHDRAWN" } }, reason }, tx);
      return tx.deviation.findUniqueOrThrow({ where: { id } });
    });
  }

  async close(actor: Actor, id: string, expectedVersion: number, reason: string) {
    return this.db.tx(async (tx) => {
      const d = await this.lock(tx, id, expectedVersion);
      if (d.status !== "APPROVED" && d.status !== "EXPIRED") throw new InvalidTransitionError("Deviation", d.status, "closed");
      await tx.deviation.update({ where: { id }, data: { status: "CLOSED", version: { increment: 1 } } });
      await this.audit.record({ eventType: "deviation.closed", entityType: "DEVIATION", entityId: id, entityLabel: d.number, changes: { status: { before: d.status, after: "CLOSED" } }, reason }, tx);
      await this.activity.record(tx, { entityType: "DEVIATION", entityId: id, entityLabel: d.number, verb: "closed", summary: `Closed: ${reason}`, visibility: "SUPPLIER", supplierId: d.supplierId });
      return tx.deviation.findUniqueOrThrow({ where: { id } });
    });
  }
}
