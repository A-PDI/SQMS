import { Injectable } from "@nestjs/common";
import type { Prisma, ScarStatus } from "@sqms/db";
import type { Actor } from "../../common/auth/actor";
import { AccessScope } from "../../common/auth/access-scope";
import { ActivityService } from "../../common/audit/activity.service";
import { AuditService, diffControlled } from "../../common/audit/audit.service";
import { DbService, type Tx } from "../../common/db/db.service";
import { BusinessRuleError, ForbiddenError, InvalidTransitionError, NotFoundError, StaleVersionError } from "../../common/errors/app-errors";
import { toDate } from "../../common/http/dto-helpers";
import { pageArgs, sortArg, trimQ, type Page } from "../../common/http/pagination";
import { NotificationService } from "../../common/services/notification.service";
import { NumberingService } from "../../common/services/numbering.service";
import { OutboxService } from "../../common/services/outbox.service";
import { SettingsService } from "../../common/services/settings.service";
import type { CreateScarDto, ScarListQuery, ScarResponseDto, UpdateScarDto } from "./quality.dto";

const AWAITING_RESPONSE: ScarStatus[] = ["ISSUED", "RESPONSE_REJECTED"];
const OPEN_SCAR: ScarStatus[] = ["ISSUED", "RESPONSE_SUBMITTED", "RESPONSE_REJECTED", "ACCEPTED", "VERIFICATION"];
/** 8D sections that must be completed before a response can be submitted. */
const REQUIRED_8D = ["d1Team", "d2Problem", "d3Containment", "d4RootCause", "d5CorrectiveActions", "d6Implementation", "d7Prevention"] as const;
const DAY = 86_400_000;

const INCLUDE = {
  supplier: { select: { id: true, name: true, supplierNumber: true, organizationId: true } },
  site: { select: { id: true, siteCode: true, name: true } },
  ncr: { select: { id: true, number: true, title: true, severity: true, status: true, internalPartId: true } },
  responses: { orderBy: { revisionNumber: "desc" } },
} satisfies Prisma.CorrectiveActionInclude;

type ScarWithIncludes = Prisma.CorrectiveActionGetPayload<{ include: typeof INCLUDE }>;

const today = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

@Injectable()
export class ScarService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly numbering: NumberingService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationService,
    private readonly settings: SettingsService,
  ) {}

  private isOverdue(s: { status: ScarStatus; responseDueDate: Date }) {
    return AWAITING_RESPONSE.includes(s.status) && s.responseDueDate < today();
  }

  /** Adds derived fields and removes internal-only content for supplier users. */
  present(actor: Actor, s: ScarWithIncludes) {
    const out = { ...s, overdue: this.isOverdue(s) };
    if (AccessScope.of(actor).isInternal) return out;
    const { internalNotes: _n, ...rest } = out;
    return rest;
  }

  private where(actor: Actor, q: ScarListQuery): Prisma.CorrectiveActionWhereInput {
    const scope = AccessScope.of(actor);
    const term = trimQ(q.q);
    return {
      // Draft SCARs are internal working records.
      ...(scope.isInternal ? {} : { ...scope.supplierWhere(), AND: [{ status: { not: "DRAFT" } }] }),
      ...(q.status?.length ? { status: { in: q.status as ScarStatus[] } } : {}),
      ...(q.overdue ? { status: { in: AWAITING_RESPONSE }, responseDueDate: { lt: today() } } : {}),
      ...(q.supplierId && scope.isInternal ? { supplierId: q.supplierId } : {}),
      ...(q.ncrId ? { ncrId: q.ncrId } : {}),
      ...(term ? { OR: [{ number: { contains: term } }, { title: { contains: term } }] } : {}),
    };
  }

  async list(actor: Actor, q: ScarListQuery): Promise<Page<unknown>> {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where = this.where(actor, q);
    const [total, rows] = await Promise.all([
      this.db.client.correctiveAction.count({ where }),
      this.db.client.correctiveAction.findMany({ where, skip, take, orderBy: sortArg(q, ["number", "title", "status", "responseDueDate", "createdAt", "updatedAt"] as const, "updatedAt"), include: INCLUDE }),
    ]);
    return { total, page, pageSize, items: rows.map((r) => this.present(actor, r)) };
  }

  async exportRows(actor: Actor, q: ScarListQuery) {
    const rows = await this.db.client.correctiveAction.findMany({ where: this.where(actor, q), orderBy: { number: "asc" }, take: 10_000, include: { supplier: { select: { name: true } }, ncr: { select: { number: true } } } });
    return rows.map((r) => ({ ...r, overdue: this.isOverdue(r) }));
  }

  async get(actor: Actor, id: string) {
    const scope = AccessScope.of(actor);
    const s = await this.db.client.correctiveAction.findUnique({ where: { id }, include: INCLUDE });
    if (!s || (!scope.isInternal && (s.status === "DRAFT" || s.supplierId !== scope.supplierId))) throw new NotFoundError("Corrective action request");
    return this.present(actor, s);
  }

  async create(actor: Actor, dto: CreateScarDto) {
    return this.db.tx(async (tx) => {
      const ncr = dto.ncrId ? await tx.nonconformance.findUnique({ where: { id: dto.ncrId } }) : null;
      if (dto.ncrId && !ncr) throw new NotFoundError("Nonconformance");
      if (ncr && ["CANCELLED"].includes(ncr.status)) throw new BusinessRuleError("The NCR is cancelled");
      const supplierId = ncr?.supplierId ?? dto.supplierId;
      if (!supplierId) throw new BusinessRuleError("Identify the supplier or the originating NCR");
      if (ncr && dto.supplierId && dto.supplierId !== ncr.supplierId) throw new BusinessRuleError("The supplier does not match the NCR");
      const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw new NotFoundError("Supplier");
      const siteId = dto.siteId ?? ncr?.siteId ?? null;
      if (siteId && !(await tx.supplierSite.findFirst({ where: { id: siteId, supplierId } }))) throw new BusinessRuleError("The site does not belong to the supplier");
      const severity = dto.severity ?? ncr?.severity;
      if (!severity) throw new BusinessRuleError("Severity is required");
      const days = Number(await this.settings.get("scar.defaultResponseDays", 14));
      const responseDueDate = toDate(dto.responseDueDate) ?? new Date(today().getTime() + days * DAY);
      const containmentDueDate = toDate(dto.containmentDueDate) ?? null;
      if (containmentDueDate && containmentDueDate > responseDueDate) throw new BusinessRuleError("Containment must be due on or before the response");
      const number = await this.numbering.next(tx, "SCAR");
      const s = await tx.correctiveAction.create({
        data: {
          number,
          title: dto.title,
          ncrId: ncr?.id ?? null,
          supplierId,
          siteId,
          problemDescription: dto.problemDescription,
          requirements: dto.requirements ?? null,
          severity,
          containmentDueDate,
          responseDueDate,
          effectivenessDueDate: toDate(dto.effectivenessDueDate) ?? null,
          internalNotes: dto.internalNotes ?? null,
          createdById: actor.userId,
        },
      });
      await this.audit.record({ eventType: "scar.created", entityType: "SCAR", entityId: s.id, entityLabel: number, metadata: { ncrId: ncr?.id ?? null, severity, responseDueDate: responseDueDate.toISOString().slice(0, 10) } }, tx);
      await this.activity.record(tx, { entityType: "SCAR", entityId: s.id, entityLabel: number, verb: "created", summary: `SCAR ${number} drafted for ${supplier.name}${ncr ? ` from ${ncr.number}` : ""}`, supplierId, internalPartId: ncr?.internalPartId ?? null });
      if (ncr) await this.activity.record(tx, { entityType: "NCR", entityId: ncr.id, entityLabel: ncr.number, verb: "scar_created", summary: `SCAR ${number} raised`, supplierId, internalPartId: ncr.internalPartId });
      return tx.correctiveAction.findUniqueOrThrow({ where: { id: s.id }, include: INCLUDE });
    });
  }

  private async lock(tx: Tx, id: string, expectedVersion?: number) {
    await this.db.lockRow(tx, "corrective_actions", id);
    const s = await tx.correctiveAction.findUnique({ where: { id }, include: { supplier: true } });
    if (!s) throw new NotFoundError("Corrective action request");
    if (expectedVersion !== undefined && s.version !== expectedVersion) throw new StaleVersionError("Corrective action request");
    return s;
  }

  async update(actor: Actor, id: string, dto: UpdateScarDto) {
    const { expectedVersion, containmentDueDate, responseDueDate, effectivenessDueDate, ...rest } = dto;
    return this.db.tx(async (tx) => {
      const before = await this.lock(tx, id, expectedVersion);
      if (before.status === "CLOSED" || before.status === "CANCELLED") throw new InvalidTransitionError("SCAR", before.status, "edited");
      // Once issued, the request content is controlled; only dates and internal notes may change.
      if (before.status !== "DRAFT" && (rest.title !== undefined || rest.problemDescription !== undefined || rest.requirements !== undefined)) {
        throw new BusinessRuleError("The request content cannot be changed after issue");
      }
      const after = await tx.correctiveAction.update({
        where: { id },
        data: {
          ...rest,
          ...(containmentDueDate !== undefined ? { containmentDueDate: toDate(containmentDueDate) } : {}),
          ...(responseDueDate !== undefined ? { responseDueDate: toDate(responseDueDate)! } : {}),
          ...(effectivenessDueDate !== undefined ? { effectivenessDueDate: toDate(effectivenessDueDate) } : {}),
          version: { increment: 1 },
        },
      });
      const changes = diffControlled(before, after, ["title", "problemDescription", "requirements", "containmentDueDate", "responseDueDate", "effectivenessDueDate"]);
      await this.audit.record({ eventType: "scar.updated", entityType: "SCAR", entityId: id, entityLabel: before.number, changes, metadata: rest.internalNotes !== undefined ? { internalNotesChanged: true } : undefined }, tx);
      if (changes?.responseDueDate) await this.activity.record(tx, { entityType: "SCAR", entityId: id, entityLabel: before.number, verb: "due_date_changed", summary: `Response due date changed to ${responseDueDate}`, visibility: "SUPPLIER", supplierId: before.supplierId });
      return tx.correctiveAction.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
  }

  async issue(actor: Actor, id: string, expectedVersion: number) {
    return this.db.tx(async (tx, after) => {
      const s = await this.lock(tx, id, expectedVersion);
      if (s.status !== "DRAFT") throw new InvalidTransitionError("SCAR", s.status, "issued");
      if (s.responseDueDate < today()) throw new BusinessRuleError("The response due date is in the past");
      await tx.correctiveAction.update({ where: { id }, data: { status: "ISSUED", issuedAt: new Date(), issuedById: actor.userId, version: { increment: 1 } } });
      await this.audit.record({ eventType: "scar.issued", entityType: "SCAR", entityId: id, entityLabel: s.number, changes: { status: { before: "DRAFT", after: "ISSUED" } }, metadata: { responseDueDate: s.responseDueDate.toISOString().slice(0, 10) } }, tx);
      await this.activity.record(tx, { entityType: "SCAR", entityId: id, entityLabel: s.number, verb: "issued", summary: `Issued to ${s.supplier.name}; 8D response due ${s.responseDueDate.toISOString().slice(0, 10)}`, visibility: "SUPPLIER", supplierId: s.supplierId });
      await this.notifications.notify(tx, after, { eventType: "scar.issued", title: `Corrective action request ${s.number}: ${s.title}`, body: `Response due ${s.responseDueDate.toISOString().slice(0, 10)}.`, entityType: "SCAR", entityId: id, link: `/quality/scars/${id}`, organizationId: s.supplier.organizationId, email: true });
      await this.outbox.publish(tx, "scar.issued", "SCAR", id, { number: s.number, supplierNumber: s.supplier.supplierNumber, responseDueDate: s.responseDueDate.toISOString().slice(0, 10) });
      return tx.correctiveAction.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
  }

  // ------------------------------------------------------------------ 8D responses

  /** Saves the supplier's draft 8D response (a new revision after a rejection). Internal users may enter it on the supplier's behalf. */
  async saveResponse(actor: Actor, id: string, dto: ScarResponseDto) {
    const scope = AccessScope.of(actor);
    if (scope.isInternal && !actor.permissions.has("scar:write")) throw new ForbiddenError("Entering a response on the supplier's behalf requires scar:write");
    if (scope.isInternal && !dto.submittedByName?.trim()) throw new BusinessRuleError("Identify the supplier representative providing the response");
    const { submittedByName, d6ImplementationDate, ...sections } = dto;
    return this.db.tx(async (tx) => {
      const s = await this.lock(tx, id);
      if (!scope.isInternal) scope.assertSupplier(s.supplierId, "Corrective action request");
      if (!AWAITING_RESPONSE.includes(s.status)) throw new InvalidTransitionError("SCAR", s.status, "responded to");
      const latest = await tx.correctiveActionResponse.findFirst({ where: { scarId: id }, orderBy: { revisionNumber: "desc" } });
      const data = {
        ...sections,
        ...(d6ImplementationDate !== undefined ? { d6ImplementationDate: toDate(d6ImplementationDate) } : {}),
        submittedById: actor.userId,
        submittedByName: (submittedByName?.trim() || actor.displayName).slice(0, 160),
      };
      const response =
        latest?.status === "DRAFT"
          ? await tx.correctiveActionResponse.update({ where: { id: latest.id }, data })
          : await tx.correctiveActionResponse.create({ data: { ...data, scarId: id, revisionNumber: (latest?.revisionNumber ?? 0) + 1, submittedByOrganizationId: s.supplier.organizationId } });
      await this.audit.record({ eventType: "scar.response_saved", entityType: "SCAR", entityId: id, entityLabel: s.number, metadata: { responseId: response.id, revision: response.revisionNumber, onBehalf: scope.isInternal } }, tx);
      return response;
    });
  }

  async submitResponse(actor: Actor, id: string, responseId: string) {
    const scope = AccessScope.of(actor);
    return this.db.tx(async (tx, after) => {
      const s = await this.lock(tx, id);
      if (!scope.isInternal) scope.assertSupplier(s.supplierId, "Corrective action request");
      if (scope.isInternal && !actor.permissions.has("scar:write")) throw new ForbiddenError();
      if (!AWAITING_RESPONSE.includes(s.status)) throw new InvalidTransitionError("SCAR", s.status, "responded to");
      const r = await tx.correctiveActionResponse.findFirst({ where: { id: responseId, scarId: id } });
      if (!r) throw new NotFoundError("Response");
      if (r.status !== "DRAFT") throw new InvalidTransitionError("Response", r.status, "submitted");
      const missing = REQUIRED_8D.filter((k) => !r[k]?.trim());
      if (missing.length) throw new BusinessRuleError("The 8D response is incomplete", { missing });
      const now = new Date();
      await tx.correctiveActionResponse.update({ where: { id: responseId }, data: { status: "SUBMITTED", submittedAt: now } });
      await tx.correctiveAction.update({ where: { id }, data: { status: "RESPONSE_SUBMITTED", version: { increment: 1 } } });
      const late = s.responseDueDate < today();
      await this.audit.record({ eventType: "scar.response_submitted", entityType: "SCAR", entityId: id, entityLabel: s.number, changes: { status: { before: s.status, after: "RESPONSE_SUBMITTED" } }, metadata: { responseId, revision: r.revisionNumber, late } }, tx);
      await this.activity.record(tx, { entityType: "SCAR", entityId: id, entityLabel: s.number, verb: "response_submitted", summary: `8D response revision ${r.revisionNumber} submitted by ${r.submittedByName}${late ? " (after the due date)" : ""}`, visibility: "SUPPLIER", supplierId: s.supplierId });
      await this.notifications.notify(tx, after, { eventType: "scar.response_submitted", title: `8D response submitted for ${s.number}`, entityType: "SCAR", entityId: id, link: `/quality/scars/${id}`, userIds: s.issuedById ? [s.issuedById] : [], roleKeys: s.issuedById ? [] : ["SUPPLIER_QUALITY"], excludeUserIds: [actor.userId] });
      return tx.correctiveActionResponse.findUniqueOrThrow({ where: { id: responseId } });
    });
  }

  async reviewResponse(actor: Actor, id: string, responseId: string, decision: "ACCEPTED" | "REJECTED", comment: string, effectivenessDueDate?: string) {
    return this.db.tx(async (tx, after) => {
      const s = await this.lock(tx, id);
      if (s.status !== "RESPONSE_SUBMITTED") throw new InvalidTransitionError("SCAR", s.status, "reviewed");
      const r = await tx.correctiveActionResponse.findFirst({ where: { id: responseId, scarId: id } });
      if (!r || r.status !== "SUBMITTED") throw new BusinessRuleError("Only a submitted response can be reviewed");
      // Four-eyes: whoever entered the response on the supplier's behalf cannot accept it.
      if (r.submittedById === actor.userId) throw new ForbiddenError("You entered this response and cannot review it");
      const now = new Date();
      await tx.correctiveActionResponse.update({ where: { id: responseId }, data: { status: decision, reviewComment: comment, reviewedById: actor.userId, reviewedAt: now } });
      const status: ScarStatus = decision === "ACCEPTED" ? "ACCEPTED" : "RESPONSE_REJECTED";
      const effDue = toDate(effectivenessDueDate) ?? s.effectivenessDueDate ?? (decision === "ACCEPTED" ? new Date(today().getTime() + 90 * DAY) : null);
      await tx.correctiveAction.update({ where: { id }, data: { status, ...(decision === "ACCEPTED" ? { effectivenessDueDate: effDue } : {}), version: { increment: 1 } } });
      await this.audit.record({ eventType: `scar.response_${decision.toLowerCase()}`, entityType: "SCAR", entityId: id, entityLabel: s.number, changes: { status: { before: s.status, after: status } }, reason: comment, metadata: { responseId, revision: r.revisionNumber } }, tx);
      await this.activity.record(tx, { entityType: "SCAR", entityId: id, entityLabel: s.number, verb: `response_${decision.toLowerCase()}`, summary: `Response revision ${r.revisionNumber} ${decision.toLowerCase()}: ${comment}`, visibility: "SUPPLIER", supplierId: s.supplierId });
      await this.notifications.notify(tx, after, { eventType: `scar.response_${decision.toLowerCase()}`, title: `8D response for ${s.number} ${decision.toLowerCase()}`, body: comment, entityType: "SCAR", entityId: id, link: `/quality/scars/${id}`, organizationId: s.supplier.organizationId });
      return tx.correctiveAction.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
  }

  /** Effectiveness verification of implemented corrective actions. Ineffective actions reopen the request for a new response. */
  async verifyEffectiveness(actor: Actor, id: string, expectedVersion: number, result: "EFFECTIVE" | "NOT_EFFECTIVE", notes: string) {
    return this.db.tx(async (tx, after) => {
      const s = await this.lock(tx, id, expectedVersion);
      if (s.status !== "ACCEPTED") throw new InvalidTransitionError("SCAR", s.status, "verified");
      const status: ScarStatus = result === "EFFECTIVE" ? "VERIFICATION" : "RESPONSE_REJECTED";
      await tx.correctiveAction.update({
        where: { id },
        data: {
          status,
          effectivenessResult: result,
          effectivenessNotes: notes,
          effectivenessVerifiedById: actor.userId,
          effectivenessVerifiedAt: new Date(),
          ...(result === "NOT_EFFECTIVE" ? { escalationLevel: { increment: 1 }, lastEscalatedAt: new Date() } : {}),
          version: { increment: 1 },
        },
      });
      await this.audit.record({ eventType: "scar.effectiveness_verified", entityType: "SCAR", entityId: id, entityLabel: s.number, changes: { status: { before: s.status, after: status }, effectivenessResult: { before: s.effectivenessResult, after: result } }, reason: notes }, tx);
      await this.activity.record(tx, { entityType: "SCAR", entityId: id, entityLabel: s.number, verb: "effectiveness_verified", summary: result === "EFFECTIVE" ? `Corrective actions verified effective: ${notes}` : `Corrective actions not effective; a revised 8D response is required: ${notes}`, visibility: "SUPPLIER", supplierId: s.supplierId });
      if (result === "NOT_EFFECTIVE") await this.notifications.notify(tx, after, { eventType: "scar.not_effective", title: `${s.number}: corrective actions not effective`, body: notes, entityType: "SCAR", entityId: id, link: `/quality/scars/${id}`, organizationId: s.supplier.organizationId, roleKeys: ["SUPPLIER_QUALITY"] });
      return tx.correctiveAction.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
  }

  async close(actor: Actor, id: string, expectedVersion: number, comment: string) {
    return this.db.tx(async (tx, after) => {
      const s = await this.lock(tx, id, expectedVersion);
      if (s.status !== "VERIFICATION" || s.effectivenessResult !== "EFFECTIVE") throw new InvalidTransitionError("SCAR", s.status, "closed (effectiveness must be verified first)");
      await tx.correctiveAction.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date(), closedById: actor.userId, closureComment: comment, version: { increment: 1 } } });
      await this.audit.record({ eventType: "scar.closed", entityType: "SCAR", entityId: id, entityLabel: s.number, changes: { status: { before: s.status, after: "CLOSED" } }, reason: comment }, tx);
      await this.activity.record(tx, { entityType: "SCAR", entityId: id, entityLabel: s.number, verb: "closed", summary: `Closed: ${comment}`, visibility: "SUPPLIER", supplierId: s.supplierId });
      await this.notifications.notify(tx, after, { eventType: "scar.closed", title: `${s.number} closed`, entityType: "SCAR", entityId: id, link: `/quality/scars/${id}`, organizationId: s.supplier.organizationId });
      await this.outbox.publish(tx, "scar.closed", "SCAR", id, { number: s.number });
      return tx.correctiveAction.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
  }

  async cancel(actor: Actor, id: string, expectedVersion: number, reason: string) {
    return this.db.tx(async (tx) => {
      const s = await this.lock(tx, id, expectedVersion);
      if (s.status === "CLOSED" || s.status === "CANCELLED") throw new InvalidTransitionError("SCAR", s.status, "cancelled");
      await tx.correctiveAction.update({ where: { id }, data: { status: "CANCELLED", closedAt: new Date(), closedById: actor.userId, closureComment: reason, version: { increment: 1 } } });
      await this.audit.record({ eventType: "scar.cancelled", entityType: "SCAR", entityId: id, entityLabel: s.number, changes: { status: { before: s.status, after: "CANCELLED" } }, reason }, tx);
      if (s.status !== "DRAFT") await this.activity.record(tx, { entityType: "SCAR", entityId: id, entityLabel: s.number, verb: "cancelled", summary: `Cancelled: ${reason}`, visibility: "SUPPLIER", supplierId: s.supplierId });
      return tx.correctiveAction.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
  }

  openStatuses() {
    return OPEN_SCAR;
  }
}
