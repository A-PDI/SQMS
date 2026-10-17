import { Injectable } from "@nestjs/common";
import type { NcrSeverity, NcrStatus, Prisma } from "@sqms/db";
import type { Actor } from "../../common/auth/actor";
import { AccessScope } from "../../common/auth/access-scope";
import { ActivityService } from "../../common/audit/activity.service";
import { AuditService, diffControlled } from "../../common/audit/audit.service";
import { DbService, type AfterCommit, type Tx } from "../../common/db/db.service";
import { BusinessRuleError, InvalidTransitionError, NotFoundError, StaleVersionError } from "../../common/errors/app-errors";
import { toDate } from "../../common/http/dto-helpers";
import { pageArgs, sortArg, trimQ, type Page } from "../../common/http/pagination";
import { NotificationService } from "../../common/services/notification.service";
import { NumberingService } from "../../common/services/numbering.service";
import { OutboxService } from "../../common/services/outbox.service";
import type { CreateNcrDto, DispositionDto, NcrListQuery, UpdateNcrDto } from "./quality.dto";

export const OPEN_NCR_STATUSES: NcrStatus[] = ["OPEN", "CONTAINED", "UNDER_INVESTIGATION"];
/** Dispositions that accept nonconforming product and therefore need an approved concession. */
const CONCESSION_DISPOSITIONS = ["USE_AS_IS_CONCESSION", "REPAIR"];

const INCLUDE = {
  supplier: { select: { id: true, name: true, supplierNumber: true } },
  site: { select: { id: true, siteCode: true, name: true } },
  internalPart: { select: { id: true, partNumber: true, description: true } },
  supplierPart: { select: { id: true, supplierPartNumber: true } },
  configurationRevision: { select: { id: true, revisionLabel: true, configuration: { select: { configCode: true } } } },
  characteristic: { select: { id: true, charNumber: true, name: true, classification: true } },
  qualification: { select: { id: true, number: true, status: true } },
  incomingInspection: { select: { id: true, number: true, originalPartNumber: true, originalSupplier: true } },
  firstArticle: { select: { id: true, number: true } },
  defectLines: true, reportSections: { where: { archivedAt: null }, orderBy: { sortOrder: "asc" } }, scarLinks: { include: { scar: { select: { id: true, number: true, status: true } } } },
  owner: { select: { id: true, displayName: true } },
  correctiveActions: { select: { id: true, number: true, status: true, responseDueDate: true } },
  deviations: { select: { id: true, number: true, type: true, status: true } },
} satisfies Prisma.NonconformanceInclude;

type NcrWithIncludes = Prisma.NonconformanceGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class NcrService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
    private readonly numbering: NumberingService,
    private readonly outbox: OutboxService,
    private readonly notifications: NotificationService,
  ) {}

  /** Removes internal-only content for supplier users. */
  present(actor: Actor, n: NcrWithIncludes) {
    if (AccessScope.of(actor).isInternal) return n;
    const { internalNotes: _notes, qualification: _q, legacyException: _legacy, qmsFields: _qmsFields, incomingInspection: _incoming, firstArticle: _fai, defectLines: _defects, reportSections: _sections, scarLinks: _links, ...rest } = n;
    return rest;
  }

  private where(actor: Actor, q: NcrListQuery): Prisma.NonconformanceWhereInput {
    const scope = AccessScope.of(actor);
    const term = trimQ(q.q);
    return {
      archivedAt: null,
      ...(scope.isInternal ? {} : { ...scope.supplierWhere(), supplierVisible: true }),
      ...(q.status?.length ? { status: { in: q.status as NcrStatus[] } } : {}),
      ...(q.open ? { status: { in: OPEN_NCR_STATUSES } } : {}),
      ...(q.severity?.length ? { severity: { in: q.severity as NcrSeverity[] } } : {}),
      ...(q.supplierId && scope.isInternal ? { supplierId: q.supplierId } : {}),
      ...(q.internalPartId ? { internalPartId: q.internalPartId } : {}),
      ...(term ? { OR: [{ number: { contains: term } }, { title: { contains: term } }, { lotNumber: { contains: term } }, { internalPart: { partNumber: { contains: term } } }] } : {}),
    };
  }

  async list(actor: Actor, q: NcrListQuery): Promise<Page<unknown>> {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where = this.where(actor, q);
    const [total, rows] = await Promise.all([
      this.db.client.nonconformance.count({ where }),
      this.db.client.nonconformance.findMany({ where, skip, take, orderBy: sortArg(q, ["number", "title", "status", "severity", "dateIdentified", "createdAt", "updatedAt"] as const, "updatedAt"), include: INCLUDE }),
    ]);
    return { total, page, pageSize, items: rows.map((r) => this.present(actor, r)) };
  }

  async exportRows(actor: Actor, q: NcrListQuery) {
    return this.db.client.nonconformance.findMany({ where: this.where(actor, q), orderBy: { number: "asc" }, take: 10_000, include: { supplier: { select: { name: true } }, internalPart: { select: { partNumber: true } }, owner: { select: { displayName: true } } } });
  }

  async get(actor: Actor, id: string) {
    const scope = AccessScope.of(actor);
    const n = await this.db.client.nonconformance.findUnique({ where: { id }, include: INCLUDE });
    if (!n || n.archivedAt || (!scope.isInternal && (!n.supplierVisible || n.supplierId !== scope.supplierId))) throw new NotFoundError("Nonconformance");
    return this.present(actor, n);
  }

  /** Validates that every referenced record belongs to the same supplier and part (ids from the client are not trusted). */
  private async resolveRefs(tx: Tx, dto: CreateNcrDto) {
    let supplierId = dto.supplierId ?? null;
    let internalPartId = dto.internalPartId ?? null;
    let supplierPartId = dto.supplierPartId ?? null;
    let siteId = dto.siteId ?? null;
    if (dto.source === "FIRST_ARTICLE" && !dto.firstArticleId || dto.source === "INCOMING_INSPECTION" && !dto.incomingInspectionId || dto.source === "ENGINEERING_VALIDATION" && !dto.testRecordId) throw new BusinessRuleError("This origin requires a linked source record; use OTHER for a manual unattributed event");
    if (dto.incomingInspectionId && dto.source !== "INCOMING_INSPECTION" || dto.firstArticleId && dto.source !== "FIRST_ARTICLE" || dto.testRecordId && dto.source !== "ENGINEERING_VALIDATION") throw new BusinessRuleError("NCR origin kind does not match the source relationship");
    const agree = (label: string, current: string | null, value: string) => {
      if (current && current !== value) throw new BusinessRuleError(`The ${label} does not match the other references`);
      return value;
    };
    if (dto.incomingInspectionId) {
      const source = await tx.incomingInspection.findUnique({ where: { id: dto.incomingInspectionId } });
      if (!source) throw new NotFoundError("Incoming inspection");
      if (source.supplierId) supplierId = agree("inspection supplier", supplierId, source.supplierId);
      if (source.internalPartId) internalPartId = agree("inspection part", internalPartId, source.internalPartId);
      if (source.siteId) siteId = agree("inspection site", siteId, source.siteId);
      if (dto.configurationRevisionId && source.configurationRevisionId !== dto.configurationRevisionId) throw new BusinessRuleError("Inspection configuration does not match the NCR");
    }
    if (dto.firstArticleId) {
      const source = await tx.firstArticleInspection.findUnique({ where: { id: dto.firstArticleId } });
      if (!source || source.qualificationId !== dto.qualificationId || source.configurationRevisionId !== dto.configurationRevisionId) throw new BusinessRuleError("FAI origin must match the qualification and configuration revision");
    }
    if (dto.testRecordId) {
      const source = await tx.testRecord.findUnique({ where: { id: dto.testRecordId }, include: { qualification: true } });
      if (!source || source.qualificationId !== dto.qualificationId || source.qualification.configurationRevisionId !== dto.configurationRevisionId) throw new BusinessRuleError("Validation origin must match its qualification and revision");
    }
    if (dto.supplierProductId) {
      const sp = await tx.supplierProduct.findUnique({ where: { id: dto.supplierProductId } });
      if (!sp) throw new NotFoundError("Supplier product");
      supplierId = agree("supplier", supplierId, sp.supplierId);
      internalPartId = agree("part", internalPartId, sp.internalPartId);
      supplierPartId = agree("supplier part", supplierPartId, sp.supplierPartId);
      siteId = agree("site", siteId, sp.siteId);
    }
    if (dto.configurationRevisionId) {
      const rev = await tx.configurationRevision.findUnique({ where: { id: dto.configurationRevisionId }, include: { configuration: { include: { supplierProduct: true } } } });
      if (!rev) throw new NotFoundError("Configuration revision");
      supplierId = agree("configuration supplier", supplierId, rev.configuration.supplierId);
      internalPartId = agree("configuration part", internalPartId, rev.configuration.supplierProduct.internalPartId);
      siteId = agree("configuration site", siteId, rev.configuration.supplierProduct.siteId);
      supplierPartId = agree("configuration supplier part", supplierPartId, rev.configuration.supplierProduct.supplierPartId);
      if (dto.supplierProductId && rev.configuration.supplierProductId !== dto.supplierProductId) throw new BusinessRuleError("Configuration supplier-product differs from the referenced product");
    }
    if (dto.characteristicId && !dto.configurationRevisionId) throw new BusinessRuleError("A characteristic requires its configuration revision");
    if (dto.characteristicId) {
      const c = await tx.criticalCharacteristic.findUnique({ where: { id: dto.characteristicId } });
      if (!c || (dto.configurationRevisionId && c.configurationRevisionId !== dto.configurationRevisionId)) throw new BusinessRuleError("The characteristic does not belong to the referenced configuration revision");
    }
    if (dto.qualificationId) {
      const q = await tx.productQualification.findUnique({ where: { id: dto.qualificationId }, include: { supplierProduct: true } });
      if (!q) throw new NotFoundError("Product qualification");
      supplierId = agree("qualification supplier", supplierId, q.supplierId);
      internalPartId = agree("qualification part", internalPartId, q.supplierProduct.internalPartId);
      if (dto.configurationRevisionId && q.configurationRevisionId !== dto.configurationRevisionId) throw new BusinessRuleError("Qualification revision differs from the NCR revision");
    }


    const [supplier, part] = await Promise.all([supplierId ? tx.supplier.findUnique({ where: { id: supplierId } }) : null, internalPartId ? tx.internalPart.findUnique({ where: { id: internalPartId } }) : null]);
    if (supplierId && !supplier) throw new NotFoundError("Supplier");
    if (internalPartId && !part) throw new NotFoundError("Part");
    if (siteId && !supplierId || supplierPartId && !supplierId) throw new BusinessRuleError("A site or supplier part requires its supplier");
    if (siteId && !(await tx.supplierSite.findFirst({ where: { id: siteId, supplierId: supplierId! } }))) throw new BusinessRuleError("The site does not belong to the supplier");
    if (supplierPartId && !(await tx.supplierPart.findFirst({ where: { id: supplierPartId, supplierId: supplierId! } }))) throw new BusinessRuleError("The supplier part does not belong to the supplier");
    return { supplier, part, supplierId, internalPartId, supplierPartId, siteId };
  }

  async create(actor: Actor, dto: CreateNcrDto) {
    return this.db.tx(async (tx, after) => {
      const n = await this.createIn(tx, after, actor, dto);
      await tx.ncrDefectLine.create({ data: { ncrId: n.id, defectCode: "OTHER", deviationDirection: "UNKNOWN", severity: n.severity, specification: { specification: n.expectedSpecification ?? null, physicalFeatureUnresolved: true }, actualCondition: n.defectDescription, quantityAffected: n.quantityAffected ?? 1 } });
      return n;
    });
  }

  async createIn(tx: Tx, after: AfterCommit, actor: Actor, dto: CreateNcrDto) {
      const refs = await this.resolveRefs(tx, dto);
      const ownerId = dto.ownerId ?? actor.userId;
      const owner = await tx.user.findFirst({ where: { id: ownerId, userType: "INTERNAL", status: "ACTIVE" } });
      if (!owner) throw new BusinessRuleError("The NCR owner must be an active internal user");
      const number = await this.numbering.next(tx, "NCR");
      const n = await tx.nonconformance.create({
        data: {
          number,
          incomingInspectionId: dto.incomingInspectionId, firstArticleId: dto.firstArticleId, testRecordId: dto.testRecordId,
          title: dto.title,
          dateIdentified: toDate(dto.dateIdentified)!,
          source: dto.source,
          supplierId: refs.supplierId,
          siteId: refs.siteId,
          internalPartId: refs.internalPartId,
          supplierPartId: refs.supplierPartId,
          supplierProductId: dto.supplierProductId ?? null,
          configurationRevisionId: dto.configurationRevisionId ?? null,
          characteristicId: dto.characteristicId ?? null,
          qualificationId: dto.qualificationId ?? null,
          purchaseOrder: dto.purchaseOrder,
          lotNumber: dto.lotNumber ?? null,
          serialNumbers: dto.serialNumbers ?? null,
          quantityAffected: dto.quantityAffected,
          quantityInspected: dto.quantityInspected ?? null,
          defectDescription: dto.defectDescription,
          expectedSpecification: dto.expectedSpecification ?? null,
          actualCondition: dto.actualCondition ?? null,
          inspectionResults: dto.inspectionResults ?? null,
          severity: dto.severity,
          containmentAction: dto.containmentAction ?? null,
          blocksApproval: dto.blocksApproval ?? true,
          ownerId,
          internalNotes: dto.internalNotes ?? null,
          supplierVisible: dto.supplierVisible ?? false,
          createdById: actor.userId,
        },
      });
      await this.audit.record({ eventType: "ncr.created", entityType: "NCR", entityId: n.id, entityLabel: number, metadata: { severity: dto.severity, source: dto.source, supplierId: refs.supplierId, quantityAffected: dto.quantityAffected } }, tx);
      await this.activity.record(tx, { entityType: "NCR", entityId: n.id, entityLabel: number, verb: "created", summary: `${dto.severity} nonconformance ${number} raised on ${refs.part?.partNumber ?? "unresolved part"} from ${refs.supplier?.name ?? "unattributed source"}: ${dto.title}`, supplierId: refs.supplierId, internalPartId: refs.internalPartId });
      await this.notifications.notify(tx, after, { eventType: "ncr.created", title: `${dto.severity} NCR ${number}: ${refs.part?.partNumber ?? "unresolved part"} - ${refs.supplier?.name ?? "unattributed source"}`, entityType: "NCR", entityId: n.id, link: `/quality/ncrs/${n.id}`, userIds: ownerId !== actor.userId ? [ownerId] : [], roleKeys: dto.severity === "CRITICAL" ? ["SUPPLIER_QUALITY", "APPROVER"] : ["SUPPLIER_QUALITY"], excludeUserIds: [actor.userId] });
      await this.outbox.publish(tx, "ncr.created", "NCR", n.id, { number, severity: dto.severity, supplierNumber: refs.supplier?.supplierNumber ?? null, partNumber: refs.part?.partNumber ?? "unresolved part" });
      return tx.nonconformance.findUniqueOrThrow({ where: { id: n.id }, include: INCLUDE });

  }

  async lock(tx: Tx, id: string, expectedVersion?: number) {
    await this.db.lockRow(tx, "nonconformances", id);
    const n = await tx.nonconformance.findUnique({ where: { id } });
    if (!n) throw new NotFoundError("Nonconformance");
    if (expectedVersion !== undefined && n.version !== expectedVersion) throw new StaleVersionError("Nonconformance");
    return n;
  }

  async update(actor: Actor, id: string, dto: UpdateNcrDto) {
    const { expectedVersion, ...data } = dto;
    return this.db.tx(async (tx) => {
      const before = await this.lock(tx, id, expectedVersion);
      if (!OPEN_NCR_STATUSES.includes(before.status)) throw new InvalidTransitionError("NCR", before.status, "edited");
      if (data.ownerId && !(await tx.user.findFirst({ where: { id: data.ownerId, userType: "INTERNAL", status: "ACTIVE" } }))) throw new BusinessRuleError("The NCR owner must be an active internal user");
      const after = await tx.nonconformance.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      const changes = diffControlled(before, after, ["title", "lotNumber", "quantityAffected", "quantityInspected", "defectDescription", "severity", "blocksApproval", "ownerId", "supplierVisible"]);
      await this.audit.record({ eventType: "ncr.updated", entityType: "NCR", entityId: id, entityLabel: before.number, changes, metadata: data.internalNotes !== undefined ? { internalNotesChanged: true } : undefined }, tx);
      if (changes) await this.activity.record(tx, { entityType: "NCR", entityId: id, entityLabel: before.number, verb: "updated", summary: `Updated ${Object.keys(changes).join(", ")}`, supplierId: before.supplierId, internalPartId: before.internalPartId });
      return tx.nonconformance.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
  }

  async contain(actor: Actor, id: string, expectedVersion: number, action: string, completed: boolean) {
    return this.db.tx(async (tx) => {
      const n = await this.lock(tx, id, expectedVersion);
      if (!OPEN_NCR_STATUSES.includes(n.status)) throw new InvalidTransitionError("NCR", n.status, "contained");
      const status: NcrStatus = n.status === "OPEN" && completed ? "CONTAINED" : n.status;
      await tx.nonconformance.update({ where: { id }, data: { containmentAction: action, ...(completed ? { containmentCompletedAt: new Date() } : {}), status, version: { increment: 1 } } });
      await this.audit.record({ eventType: "ncr.containment_recorded", entityType: "NCR", entityId: id, entityLabel: n.number, changes: status !== n.status ? { status: { before: n.status, after: status } } : null, metadata: { completed } }, tx);
      await this.activity.record(tx, { entityType: "NCR", entityId: id, entityLabel: n.number, verb: "containment", summary: `Containment ${completed ? "completed" : "recorded"}: ${action}`, supplierId: n.supplierId, internalPartId: n.internalPartId });
      return tx.nonconformance.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
  }

  async investigate(actor: Actor, id: string, expectedVersion: number) {
    return this.db.tx(async (tx) => {
      const n = await this.lock(tx, id, expectedVersion);
      if (n.status !== "OPEN" && n.status !== "CONTAINED") throw new InvalidTransitionError("NCR", n.status, "moved to investigation");
      await tx.nonconformance.update({ where: { id }, data: { status: "UNDER_INVESTIGATION", version: { increment: 1 } } });
      await this.audit.record({ eventType: "ncr.investigation_started", entityType: "NCR", entityId: id, entityLabel: n.number, changes: { status: { before: n.status, after: "UNDER_INVESTIGATION" } } }, tx);
      return tx.nonconformance.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
  }

  /**
   * Material Review disposition. Accepting nonconforming product (use-as-is or repair) requires an approved concession
   * linked to this NCR.
   */
  async disposition(actor: Actor, id: string, dto: DispositionDto) {
    return this.db.tx(async (tx, after) => {
      const n = await this.lock(tx, id, dto.expectedVersion);
      if (!OPEN_NCR_STATUSES.includes(n.status)) throw new InvalidTransitionError("NCR", n.status, "dispositioned");
      if (CONCESSION_DISPOSITIONS.includes(dto.disposition)) {
        const concession = dto.deviationId
          ? await tx.deviation.findFirst({ where: { id: dto.deviationId, ncrId: id } })
          : await tx.deviation.findFirst({ where: { ncrId: id, type: "CONCESSION", status: "APPROVED" }, orderBy: { decidedAt: "desc" } });
        if (!concession || concession.type !== "CONCESSION" || concession.status !== "APPROVED") {
          throw new BusinessRuleError(`Disposition ${dto.disposition} requires an approved concession linked to ${n.number}`);
        }
      }
      if (dto.disposition === "HOLD") throw new BusinessRuleError("HOLD is an interim state; record containment instead and disposition when the material review is complete");
      await tx.nonconformance.update({ where: { id }, data: { disposition: dto.disposition, dispositionNotes: dto.dispositionNotes, dispositionById: actor.userId, dispositionAt: new Date(), status: "DISPOSITIONED", version: { increment: 1 } } });
      await this.audit.record({ eventType: "ncr.dispositioned", entityType: "NCR", entityId: id, entityLabel: n.number, changes: { status: { before: n.status, after: "DISPOSITIONED" }, disposition: { before: n.disposition, after: dto.disposition } }, reason: dto.dispositionNotes, metadata: { deviationId: dto.deviationId } }, tx);
      await this.activity.record(tx, { entityType: "NCR", entityId: id, entityLabel: n.number, verb: "dispositioned", summary: `Dispositioned ${dto.disposition}: ${dto.dispositionNotes}`, supplierId: n.supplierId, internalPartId: n.internalPartId });
      await this.outbox.publish(tx, "ncr.dispositioned", "NCR", id, { number: n.number, disposition: dto.disposition });
      void after;
      return tx.nonconformance.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
  }

  async close(actor: Actor, id: string, expectedVersion: number, comment: string) {
    return this.db.tx(async (tx) => {
      const n = await this.lock(tx, id, expectedVersion);
      if (n.status !== "DISPOSITIONED") throw new InvalidTransitionError("NCR", n.status, "closed (disposition it first)");
      await tx.nonconformance.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date(), closedById: actor.userId, closureComment: comment, version: { increment: 1 } } });
      await this.audit.record({ eventType: "ncr.closed", entityType: "NCR", entityId: id, entityLabel: n.number, changes: { status: { before: n.status, after: "CLOSED" } }, reason: comment }, tx);
      await this.activity.record(tx, { entityType: "NCR", entityId: id, entityLabel: n.number, verb: "closed", summary: `Closed: ${comment}`, supplierId: n.supplierId, internalPartId: n.internalPartId });
      return tx.nonconformance.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
  }

  async cancel(actor: Actor, id: string, expectedVersion: number, reason: string) {
    return this.db.tx(async (tx) => {
      const n = await this.lock(tx, id, expectedVersion);
      if (!OPEN_NCR_STATUSES.includes(n.status)) throw new InvalidTransitionError("NCR", n.status, "cancelled");
      const scars = await tx.correctiveAction.count({ where: { OR: [{ ncrId: id }, { ncrLinks: { some: { ncrId: id } } }], status: { notIn: ["CANCELLED", "CLOSED"] } } });
      if (scars) throw new BusinessRuleError("Cancel or close the corrective actions raised from this NCR first");
      await tx.nonconformance.update({ where: { id }, data: { status: "CANCELLED", closedAt: new Date(), closedById: actor.userId, closureComment: reason, version: { increment: 1 } } });
      await this.audit.record({ eventType: "ncr.cancelled", entityType: "NCR", entityId: id, entityLabel: n.number, changes: { status: { before: n.status, after: "CANCELLED" } }, reason }, tx);
      return tx.nonconformance.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
  }
}
