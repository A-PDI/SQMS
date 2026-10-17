import { Injectable } from "@nestjs/common";
import { Prisma, type Nonconformance } from "@sqms/db";
import { generateNcrPdf } from "@sqms/legacy-domain";
import type { Actor } from "../../common/auth/actor";
import { AccessScope } from "../../common/auth/access-scope";
import { AuditService } from "../../common/audit/audit.service";
import {
  DbService,
  type AfterCommit,
  type Tx,
} from "../../common/db/db.service";
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from "../../common/errors/app-errors";
import { OutboxService } from "../../common/services/outbox.service";
import { NotificationService } from "../../common/services/notification.service";
import { pageArgs, type PageQueryDto } from "../../common/http/pagination";
import { SettingsService } from "../../common/services/settings.service";
import { NcrService, OPEN_NCR_STATUSES } from "../quality/ncr.service";
import type { CreateNcrDto } from "../quality/quality.dto";
import type {
  DefectLinesDto,
  FeatureDto,
  FeatureMappingDto,
  OriginNcrDto,
  ReportSectionsDto,
} from "./connected-quality.dto";
import { EvidenceService } from "./evidence.service";
import {
  digest,
  disposition,
  inspectionItems,
  object,
  type JsonObject,
} from "./operations.rules";

const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
type MatchSource = {
  supplierId: string | null;
  internalPartId: string | null;
  siteId: string | null;
  configurationRevisionId: string | null;
  id?: string;
  dateIdentified?: Date;
};
type Defect = {
  featureId: string | null;
  defectCode: string;
  deviationDirection: string;
  specification?: unknown;
  actualCondition?: string;
};
function direction(value: number | null, spec: JsonObject): string {
  if (value == null) return "UNKNOWN";
  if (spec.minimum != null && value < Number(spec.minimum)) return "BELOW";
  if (spec.maximum != null && value > Number(spec.maximum)) return "ABOVE";
  return "OTHER";
}
@Injectable()
export class ConnectedQualityService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly ncrs: NcrService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly evidence: EvidenceService,
    private readonly notifications: NotificationService,
  ) {}
  features(partId: string) {
    return this.db.client.featureIdentity.findMany({
      where: { internalPartId: partId },
      include: { revisionMappings: true },
      orderBy: { key: "asc" },
    });
  }
  async feature(actor: Actor, dto: FeatureDto) {
    return this.db.tx(async (tx) => {
      if (
        !(await tx.internalPart.findUnique({
          where: { id: dto.internalPartId },
        }))
      )
        throw new NotFoundError("Part");
      const r = await tx.featureIdentity.create({ data: dto });
      await this.audit.record(
        {
          eventType: "feature.created",
          entityType: "INTERNAL_PART",
          entityId: dto.internalPartId,
          metadata: { featureId: r.id, key: r.key },
        },
        tx,
      );
      return r;
    });
  }
  async mapFeature(actor: Actor, dto: FeatureMappingDto) {
    if (dto.reason.trim().length < 5)
      throw new BusinessRuleError(
        "A mapping needs a meaningful engineering rationale",
      );
    return this.db.tx(async (tx) => {
      const f = await tx.featureIdentity.findUnique({
        where: { id: dto.featureId },
      });
      const rev = await tx.configurationRevision.findUnique({
        where: { id: dto.configurationRevisionId },
        include: { configuration: { include: { supplierProduct: true } } },
      });
      if (
        !f ||
        !rev ||
        f.internalPartId !== rev.configuration.supplierProduct.internalPartId
      )
        throw new BusinessRuleError(
          "Feature and revision must belong to the same internal part",
        );
      if (dto.characteristicId) {
        const c = await tx.criticalCharacteristic.findUnique({
          where: { id: dto.characteristicId },
        });
        if (!c || c.configurationRevisionId !== rev.id)
          throw new BusinessRuleError(
            "The characteristic must belong to the mapped revision",
          );
        if (c.featureId && c.featureId !== f.id)
          throw new BusinessRuleError(
            "A mapped characteristic cannot be silently reassigned to a different physical feature",
          );
        await tx.criticalCharacteristic.update({
          where: { id: c.id },
          data: { featureId: f.id },
        });
      }
      const identity = { featureId: f.id, configurationRevisionId: rev.id };
      const before = await tx.featureRevisionMapping.findUnique({
        where: { featureId_configurationRevisionId: identity },
      });
      const data = {
        ...identity,
        compatibility: dto.compatibility,
        balloonAlias: dto.balloonAlias,
        reason: dto.reason,
        reviewedById: actor.userId,
        reviewedAt: new Date(),
      };
      const r = await tx.featureRevisionMapping.upsert({
        where: { featureId_configurationRevisionId: identity },
        create: data,
        update: data,
      });
      await this.audit.record(
        {
          eventType: "feature.revision_mapped",
          entityType: "CONFIGURATION_REVISION",
          entityId: rev.id,
          reason: dto.reason,
          metadata: {
            featureId: f.id,
            before: before
              ? {
                  compatibility: before.compatibility,
                  balloonAlias: before.balloonAlias,
                }
              : null,
            compatibility: dto.compatibility,
          },
        },
        tx,
      );
      return r;
    });
  }
  private async matches(
    tx: Tx,
    source: MatchSource,
    defects: Defect[],
    lookbackDays: number,
  ) {
    if (!source.supplierId || !source.internalPartId) return [];
    const featureIds = [
      ...new Set(
        defects.map((d) => d.featureId).filter((v): v is string => !!v),
      ),
    ];
    if (!featureIds.length) return [];
    const now = source.dateIdentified ?? new Date();
    const since = new Date(now.getTime() - lookbackDays * 86_400_000);
    const prior = await tx.nonconformance.findMany({
      where: {
        supplierId: source.supplierId,
        internalPartId: source.internalPartId,
        ...(source.id ? { id: { not: source.id } } : {}),
        status: { not: "CANCELLED" },
        dateIdentified: { gte: since, lte: now },
        defectLines: { some: { featureId: { in: featureIds } } },
      },
      include: {
        defectLines: true,
        correctiveActions: {
          select: {
            id: true,
            number: true,
            status: true,
            effectivenessResult: true,
          },
        },
        scarLinks: {
          include: {
            scar: {
              select: {
                id: true,
                number: true,
                status: true,
                effectivenessResult: true,
              },
            },
          },
        },
        firstArticle: { select: { id: true, number: true } },
      },
      orderBy: { dateIdentified: "desc" },
      take: 500,
    });
    const mappings = await tx.featureRevisionMapping.findMany({
      where: { featureId: { in: featureIds } },
    });
    return prior.flatMap((n) => {
      if (source.siteId && n.siteId && source.siteId !== n.siteId) return [];
      const lines = n.defectLines.flatMap((old) =>
        defects
          .filter(
            (d) =>
              d.featureId &&
              d.featureId === old.featureId &&
              d.defectCode === old.defectCode &&
              d.deviationDirection === old.deviationDirection,
          )
          .flatMap((d) => {
            const sameRevision =
              !!source.configurationRevisionId &&
              source.configurationRevisionId === n.configurationRevisionId;
            const a = mappings.find(
              (m) =>
                m.featureId === d.featureId &&
                m.configurationRevisionId === source.configurationRevisionId,
            );
            const b = mappings.find(
              (m) =>
                m.featureId === d.featureId &&
                m.configurationRevisionId === n.configurationRevisionId,
            );
            if (
              a?.compatibility === "INCOMPATIBLE" ||
              b?.compatibility === "INCOMPATIBLE"
            )
              return [];
            const compatible =
              sameRevision ||
              (a?.compatibility === "COMPATIBLE" &&
                b?.compatibility === "COMPATIBLE");
            return [
              {
                featureId: d.featureId,
                defectCode: d.defectCode,
                deviationDirection: d.deviationDirection,
                revisionCompatible: compatible,
                currentCondition: d.actualCondition ?? null,
                historicalCondition: old.actualCondition,
                historicalSpecification: old.specification,
                currentSpecification: d.specification ?? null,
                explanation: [
                  "Same supplier and internal part",
                  "Same stable physical feature, defect code and deviation direction",
                  sameRevision
                    ? "Same configuration revision"
                    : compatible
                      ? "Explicit compatible engineering mappings across revisions"
                      : "Revision comparison needs engineering review",
                  source.siteId && n.siteId
                    ? "Same manufacturing site"
                    : "Historical or current manufacturing site is unknown",
                ],
              },
            ];
          }),
      );
      return lines.length
        ? [
            {
              ncr: {
                id: n.id,
                number: n.number,
                title: n.title,
                source: n.source,
                status: n.status,
                firstArticle: n.firstArticle,
                dateIdentified: n.dateIdentified,
                correctiveActions: [
                  ...n.correctiveActions,
                  ...n.scarLinks.map((l) => l.scar),
                ],
              },
              lines,
              potentialEffectivenessConcern:
                n.correctiveActions.length > 0 || n.scarLinks.length > 0,
              caution:
                "A candidate match does not establish recurrence or failure of a corrective action",
            },
          ]
        : [];
    });
  }
  private async window() {
    const configured = Number(
      await this.settings.get<number>("qms.recurrence.lookbackDays", 1825),
    );
    return Number.isFinite(configured)
      ? Math.max(1, Math.min(36500, configured))
      : 1825;
  }
  private async persistMatches(
    tx: Tx,
    n: Nonconformance,
    days: number,
    after: AfterCommit,
  ) {
    const defects = await tx.ncrDefectLine.findMany({ where: { ncrId: n.id } });
    const matches = await this.matches(tx, n, defects, days);
    for (const match of matches)
      await tx.recurrenceReview.upsert({
        where: {
          currentNcrId_historicalNcrId: {
            currentNcrId: n.id,
            historicalNcrId: match.ncr.id,
          },
        },
        create: {
          currentNcrId: n.id,
          historicalNcrId: match.ncr.id,
          explanation: json(match),
        },
        update: {},
      });
    if (matches.length)
      await this.notifications.notify(tx, after, {
        eventType: "quality.recurrence_candidate",
        title: `${n.number}: ${matches.length} historical defect candidates to review`,
        roleKeys: ["QUALITY_MANAGER", "SUPPLIER_QUALITY"],
        entityType: "NCR",
        entityId: n.id,
        link: `/quality/ncrs/${n.id}`,
      });
    return matches;
  }
  async incomingCandidates(id: string) {
    const days = await this.window();
    const r = await this.db.client.incomingInspection.findUnique({
      where: { id },
      include: {
        measurements: { where: { outcome: "FAIL", supersededAt: null } },
      },
    });
    if (!r) throw new NotFoundError("Incoming inspection");
    const defects = r.measurements.map((m) => ({
      featureId: m.featureId,
      defectCode: object(m.specification).defectCode ?? "DIMENSIONAL",
      deviationDirection: direction(
        m.value == null ? null : Number(m.value),
        object(m.specification),
      ),
      specification: m.specification,
      actualCondition: String(m.value ?? m.textValue ?? "Failed"),
    }));
    return {
      lookbackDays: days,
      unresolved: !r.supplierId || !r.internalPartId,
      candidates: await this.matches(this.db.client, r, defects, days),
    };
  }
  private async originCommand(
    actor: Actor,
    sourceType: string,
    id: string,
    dto: OriginNcrDto,
    work: (tx: Tx, after: AfterCommit) => Promise<any>,
  ) {
    const payload = {
      ...dto,
      requestKey: undefined,
      resultIds: [...dto.resultIds].sort(),
    };
    const payloadHash = digest({ sourceType, sourceId: id, payload });
    const key = dto.requestKey ?? payloadHash;
    return this.db.tx(async (tx, after) => {
      const command = await tx.qualityCommand.upsert({
        where: { key },
        create: { key, payloadHash, actorId: actor.userId, sourceId: id },
        update: {},
      });
      if (
        command.payloadHash !== payloadHash ||
        command.sourceId !== id ||
        command.actorId !== actor.userId
      )
        throw new ConflictError(
          "This request key belongs to a different source, user or command",
        );
      if (command.ncrId)
        return {
          ...(await tx.nonconformance.findUniqueOrThrow({
            where: { id: command.ncrId },
          })),
          candidates: (
            await tx.recurrenceReview.findMany({
              where: { currentNcrId: command.ncrId },
            })
          ).map((r) => r.explanation),
          replayed: true,
        };
      const result = await work(tx, after);
      await tx.qualityCommand.update({
        where: { key },
        data: { ncrId: result.id },
      });
      return result;
    });
  }
  async fromIncoming(actor: Actor, id: string, dto: OriginNcrDto) {
    const days = await this.window();
    return this.originCommand(actor, "INCOMING", id, dto, async (tx, after) => {
      await this.db.lockRow(tx, "incoming_inspections", id);
      const r = await tx.incomingInspection.findUnique({
        where: { id },
        include: {
          measurements: {
            where: { id: { in: dto.resultIds }, supersededAt: null },
          },
        },
      });
      if (!r) throw new NotFoundError("Incoming inspection");
      if (
        new Set(dto.resultIds).size !== dto.resultIds.length ||
        r.measurements.length !== dto.resultIds.length ||
        r.measurements.some((m) => m.outcome !== "FAIL")
      )
        throw new BusinessRuleError(
          "Choose failed measurements from this inspection",
        );
      const rawItems = inspectionItems(object(r.sectionData), r.itemCount);
      const selectedItems = rawItems
        .map((item, position) => ({ item, position }))
        .filter(
          ({ item, position }) =>
            (!dto.itemPositions?.length ||
              dto.itemPositions.includes(position)) &&
            ["FAIL", "REJECT", "REJECTED", "ACCEPTED"].includes(
              disposition(item.__disposition),
            ),
        );
      if (!dto.resultIds.length && !selectedItems.length)
        throw new BusinessRuleError(
          "Select a failed measurement or an item requiring a nonconformance report",
        );
      const description = r.measurements.length
        ? r.measurements
            .map(
              (m) =>
                `${m.characteristicKey}: ${m.value ?? m.textValue ?? "failed"}`,
            )
            .join("; ")
        : selectedItems
            .map(
              ({ item, position }) =>
                `Item ${position + 1}${item.__serial_no ? ` (${item.__serial_no})` : ""}: ${item.__disposition_notes || disposition(item.__disposition)}`,
            )
            .join("; ");
      const n = await this.ncrs.createIn(tx, after, actor, {
        title: dto.title,
        dateIdentified: new Date().toISOString().slice(0, 10),
        source: "INCOMING_INSPECTION",
        incomingInspectionId: id,
        supplierId: r.supplierId ?? undefined,
        internalPartId: r.internalPartId ?? undefined,
        supplierProductId: r.supplierProductId ?? undefined,
        configurationRevisionId: r.configurationRevisionId ?? undefined,
        siteId: r.siteId ?? undefined,
        purchaseOrder: String(object(r.header).po_number ?? "") || undefined,
        serialNumbers:
          selectedItems
            .map(({ item }) => item.__serial_no)
            .filter(Boolean)
            .join(", ") || undefined,
        quantityAffected: dto.quantityAffected,
        defectDescription: description,
        severity: dto.severity ?? "MAJOR",
        lotNumber: String(object(r.header).lot_serial_no ?? "") || undefined,
      } as CreateNcrDto);
      for (const m of r.measurements)
        await tx.ncrDefectLine.create({
          data: {
            ncrId: n.id,
            measurementId: m.id,
            featureId: m.featureId,
            defectCode: dto.defectCode,
            deviationDirection: direction(
              m.value == null ? null : Number(m.value),
              object(m.specification),
            ),
            severity: dto.severity ?? "MAJOR",
            specification: m.specification as Prisma.InputJsonValue,
            actualCondition: String(m.value ?? m.textValue ?? "Failed"),
            quantityAffected: dto.quantityAffected,
          },
        });
      if (!r.measurements.length)
        for (const { item, position } of selectedItems)
          await tx.ncrDefectLine.create({
            data: {
              ncrId: n.id,
              defectCode: dto.defectCode,
              deviationDirection: "UNKNOWN",
              severity: dto.severity ?? "MAJOR",
              specification: json({
                planRevisionId: r.planRevisionId,
                configurationRevisionId: r.configurationRevisionId,
                itemPosition: position,
                physicalFeatureUnresolved: true,
                originalAnswers: item,
              }),
              actualCondition: String(
                item.__disposition_notes || disposition(item.__disposition),
              ),
              quantityAffected: dto.quantityAffected,
            },
          });
      const candidates = await this.persistMatches(tx, n, days, after);
      await this.outbox.publish(tx, "ncr.origin_linked", "NCR", n.id, {
        incomingInspectionId: id,
        candidates: candidates.length,
      });
      return { ...n, candidates };
    });
  }
  async fromFai(actor: Actor, id: string, dto: OriginNcrDto) {
    const days = await this.window();
    return this.originCommand(actor, "FAI", id, dto, async (tx, after) => {
      const fai = await tx.firstArticleInspection.findUnique({
        where: { id },
        include: {
          qualification: { include: { supplierProduct: true } },
          results: {
            where: { id: { in: dto.resultIds } },
            include: { characteristic: true },
          },
        },
      });
      if (!fai) throw new NotFoundError("FAI");
      if (
        new Set(dto.resultIds).size !== dto.resultIds.length ||
        fai.results.length !== dto.resultIds.length ||
        fai.results.some((r) => r.outcome !== "FAIL") ||
        (!dto.resultIds.length && fai.outcome !== "FAIL")
      )
        throw new BusinessRuleError(
          "Choose failed characteristics from this FAI",
        );
      const q = fai.qualification;
      const n = await this.ncrs.createIn(tx, after, actor, {
        title: dto.title,
        dateIdentified: new Date().toISOString().slice(0, 10),
        source: "FIRST_ARTICLE",
        firstArticleId: id,
        qualificationId: q.id,
        supplierProductId: q.supplierProductId,
        configurationRevisionId: fai.configurationRevisionId,
        quantityAffected: dto.quantityAffected,
        defectDescription:
          fai.results
            .map(
              (r) =>
                `${r.characteristic?.name ?? "FAI result"}: ${r.measuredValue ?? r.numericValue ?? "failed"}`,
            )
            .join("; ") ||
          fai.summary ||
          "FAI summary records a failed inspection; characteristic mapping unresolved",
        severity: dto.severity ?? "MAJOR",
      } as CreateNcrDto);
      for (const r of fai.results) {
        const c = r.characteristic;
        const spec = r.specificationSnapshot
          ? object(r.specificationSnapshot)
          : {
              characteristicId: c?.id,
              featureId: c?.featureId,
              nominal: c?.nominal == null ? null : Number(c.nominal),
              minimum:
                c?.nominal != null && c.toleranceMinus != null
                  ? Number(c.nominal) - Number(c.toleranceMinus)
                  : null,
              maximum:
                c?.nominal != null && c.tolerancePlus != null
                  ? Number(c.nominal) + Number(c.tolerancePlus)
                  : null,
              unit: c?.unit,
              method: c?.measurementMethod,
              specification: c?.specification,
              configurationRevisionId: fai.configurationRevisionId,
              firstArticleId: id,
            };
        await tx.ncrDefectLine.create({
          data: {
            ncrId: n.id,
            firstArticleResultId: r.id,
            featureId: spec.featureId ?? c?.featureId,
            defectCode: dto.defectCode,
            deviationDirection: direction(
              r.numericValue == null ? null : Number(r.numericValue),
              spec,
            ),
            severity: dto.severity ?? "MAJOR",
            specification: json(spec),
            actualCondition: String(
              r.measuredValue ?? r.numericValue ?? "Failed FAI characteristic",
            ),
            quantityAffected: dto.quantityAffected,
          },
        });
      }
      if (!fai.results.length)
        await tx.ncrDefectLine.create({
          data: {
            ncrId: n.id,
            defectCode: dto.defectCode,
            deviationDirection: "UNKNOWN",
            severity: dto.severity ?? "MAJOR",
            specification: json({
              firstArticleId: fai.id,
              configurationRevisionId: fai.configurationRevisionId,
              physicalFeatureUnresolved: true,
            }),
            actualCondition: fai.summary || "FAI outcome is FAIL",
            quantityAffected: dto.quantityAffected,
          },
        });
      const candidates = await this.persistMatches(tx, n, days, after);
      return { ...n, candidates };
    });
  }
  async defects(actor: Actor, id: string, dto: DefectLinesDto) {
    const days = await this.window();
    return this.db.tx(async (tx, after) => {
      const n = await this.ncrs.lock(tx, id, dto.expectedVersion);
      if (
        !OPEN_NCR_STATUSES.includes(n.status) &&
        (!n.legacyException ||
          !actor.permissions.has("ncr:disposition") ||
          !dto.reason?.trim())
      )
        throw new ConflictError(
          "Completed NCR defect lines are controlled history; historical classification requires Quality authority and a reason",
        );
      for (const d of dto.lines) {
        if (
          d.featureId &&
          !(await tx.featureIdentity.findFirst({
            where: { id: d.featureId, internalPartId: n.internalPartId ?? "" },
          }))
        )
          throw new BusinessRuleError(
            "Defect feature does not belong to the NCR part",
          );
        await tx.ncrDefectLine.create({
          data: { ...d, ncrId: id, specification: json(d.specification) },
        });
      }
      await tx.nonconformance.update({
        where: { id },
        data: { version: { increment: 1 } },
      });
      await this.audit.record(
        {
          eventType: "ncr.defects_added",
          entityType: "NCR",
          entityId: id,
          reason: dto.reason,
          metadata: {
            count: dto.lines.length,
            historicalClassification:
              !!n.legacyException && !OPEN_NCR_STATUSES.includes(n.status),
          },
        },
        tx,
      );
      return this.persistMatches(tx, n, days, after);
    });
  }
  async recurrence(id: string) {
    const n = await this.db.client.nonconformance.findUnique({ where: { id } });
    if (!n) throw new NotFoundError("NCR");
    const days = await this.window();
    return {
      lookbackDays: days,
      candidates: await this.matches(
        this.db.client,
        n,
        await this.db.client.ncrDefectLine.findMany({ where: { ncrId: id } }),
        days,
      ),
      reviews: await this.db.client.recurrenceReview.findMany({
        where: { currentNcrId: id },
      }),
    };
  }
  async signals(
    q: PageQueryDto & { status?: "CANDIDATE" | "CONFIRMED" | "DISMISSED" },
  ) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where = q.status ? { status: q.status } : {};
    const [items, total] = await Promise.all([
      this.db.client.recurrenceReview.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        include: {
          currentNcr: {
            select: {
              id: true,
              number: true,
              title: true,
              status: true,
              source: true,
            },
          },
          historicalNcr: {
            select: {
              id: true,
              number: true,
              title: true,
              status: true,
              source: true,
            },
          },
        },
      }),
      this.db.client.recurrenceReview.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
  async decide(
    actor: Actor,
    id: string,
    status: "CONFIRMED" | "DISMISSED",
    reason: string,
  ) {
    if (reason.trim().length < 5)
      throw new BusinessRuleError(
        "Record the basis for the recurrence decision",
      );
    const days = await this.window();
    return this.db.tx(async (tx) => {
      const review = await tx.recurrenceReview.findUnique({ where: { id } });
      if (!review) throw new NotFoundError("Recurrence candidate");
      if (review.status !== "CANDIDATE")
        throw new ConflictError("This candidate has already been reviewed");
      const current = await tx.nonconformance.findUniqueOrThrow({
        where: { id: review.currentNcrId },
        include: { defectLines: true },
      });
      const freshMatch = (
        await this.matches(tx, current, current.defectLines, days)
      ).find((m) => m.ncr.id === review.historicalNcrId);
      if (
        status === "CONFIRMED" &&
        !freshMatch?.lines.some((l) => l.revisionCompatible)
      )
        throw new BusinessRuleError(
          "Engineering must establish revision compatibility before recurrence can be confirmed",
        );
      const r = await tx.recurrenceReview.updateMany({
        where: { id, status: "CANDIDATE" },
        data: {
          status,
          reason,
          ...(freshMatch ? { explanation: json(freshMatch) } : {}),
          reviewedById: actor.userId,
          reviewedAt: new Date(),
        },
      });
      if (!r.count)
        throw new ConflictError("Another reviewer decided this candidate");
      await this.audit.record(
        {
          eventType: "ncr.recurrence_reviewed",
          entityType: "NCR",
          entityId: review.currentNcrId,
          reason,
          metadata: {
            reviewId: id,
            historicalNcrId: review.historicalNcrId,
            status,
          },
        },
        tx,
      );
      await this.outbox.publish(
        tx,
        "ncr.recurrence_reviewed",
        "NCR",
        review.currentNcrId,
        { historicalNcrId: review.historicalNcrId, status },
      );
      return tx.recurrenceReview.findUniqueOrThrow({ where: { id } });
    });
  }
  async reportSections(actor: Actor, id: string, dto: ReportSectionsDto) {
    return this.db.tx(async (tx) => {
      const n = await this.ncrs.lock(tx, id, dto.expectedVersion);
      if (!OPEN_NCR_STATUSES.includes(n.status))
        throw new ConflictError(
          "NCR report content is controlled after disposition",
        );
      const previous = await tx.ncrReportSection.findMany({
        where: { ncrId: id },
      });
      for (let i = 0; i < dto.sections.length; i++) {
        const section = dto.sections[i];
        if (section.id && !previous.some((p) => p.id === section.id))
          throw new BusinessRuleError(
            "Report section belongs to a different NCR",
          );
        if (section.id)
          await tx.ncrReportSection.update({
            where: { id: section.id },
            data: {
              title: section.title,
              body: section.body,
              sortOrder: i,
              archivedAt: null,
            },
          });
        else
          await tx.ncrReportSection.create({
            data: {
              ncrId: id,
              title: section.title,
              body: section.body,
              sortOrder: i,
            },
          });
      }
      // Omitted sections leave the report but remain historical records; their photos remain accessible.
      const retained = dto.sections
        .map((s) => s.id)
        .filter((v): v is string => !!v);
      await tx.ncrReportSection.updateMany({
        where: {
          ncrId: id,
          id: {
            in: previous
              .map((p) => p.id)
              .filter((oldId) => !retained.includes(oldId)),
          },
        },
        data: { archivedAt: new Date() },
      });
      await tx.nonconformance.update({
        where: { id },
        data: { version: { increment: 1 } },
      });
      await this.audit.record(
        {
          eventType: "ncr.report_edited",
          entityType: "NCR",
          entityId: id,
          metadata: { previous },
        },
        tx,
      );
      return tx.ncrReportSection.findMany({
        where: { ncrId: id, archivedAt: null },
        orderBy: { sortOrder: "asc" },
      });
    });
  }
  async pdf(actor: Actor, id: string) {
    AccessScope.of(actor).requireInternal();
    await this.ncrs.get(actor, id);
    const n = await this.db.client.nonconformance.findUniqueOrThrow({
      where: { id },
      include: { internalPart: true, supplier: true, incomingInspection: { select: { originalPartNumber: true, originalSupplier: true } } },
    });
    const sections = await this.db.client.ncrReportSection.findMany({
      where: { ncrId: id, archivedAt: null },
      orderBy: { sortOrder: "asc" },
    });
    const creator = n.createdById
      ? await this.db.client.user.findUnique({
          where: { id: n.createdById },
          select: { displayName: true },
        })
      : null;
    return this.evidence.render(actor, "NCR", id, (images) =>
      generateNcrPdf(
        {
          ncr_number: n.number,
          status: n.status.toLowerCase(),
          severity: n.severity.toLowerCase(),
          part_number:
            n.internalPart?.partNumber ??
            n.incomingInspection?.originalPartNumber ??
            object(n.legacyException).originalPartNumber,
          po_number: n.purchaseOrder,
          supplier:
            n.supplier?.name ?? n.incomingInspection?.originalSupplier ?? object(n.legacyException).originalSupplier,
          description_of_defect: n.defectDescription,
          ncr_disposition:
            object(n.legacyException).originalDisposition ??
            n.disposition?.toLowerCase(),
          quantity_affected: n.quantityAffected,
          created_at:
            object(n.legacyException).originalCreatedAt ??
            n.createdAt.toISOString(),
          closed_at: n.closedAt?.toISOString(),
          created_by_name:
            creator?.displayName ??
            object(n.legacyException).originalCreatorName ??
            "Unknown legacy creator",
        },
        {
          sections: sections.map((s) => ({
            ...s,
            images: images.filter((i) => i.section_id === s.id),
          })),
          images: images.filter(
            (i) =>
              !i.section_id || !sections.some((s) => s.id === i.section_id),
          ),
        },
      ),
    );
  }
  async scarLink(actor: Actor, id: string, scarId: string, reason: string) {
    return this.db.tx(async (tx) => {
      const n = await tx.nonconformance.findUnique({ where: { id } });
      const s = await tx.correctiveAction.findUnique({ where: { id: scarId } });
      if (!n || !s) throw new NotFoundError("NCR or SCAR");
      if (
        !n.supplierId ||
        n.supplierId !== s.supplierId ||
        (n.siteId && s.siteId && n.siteId !== s.siteId)
      )
        throw new BusinessRuleError(
          "NCR and SCAR must concern the same supplier and compatible site",
        );
      const link = await tx.ncrScarLink.upsert({
        where: { ncrId_scarId: { ncrId: id, scarId } },
        create: { ncrId: id, scarId, reason, linkedById: actor.userId },
        update: {},
      });
      await this.audit.record(
        {
          eventType: "ncr.scar_linked",
          entityType: "NCR",
          entityId: id,
          reason,
          metadata: { scarId },
        },
        tx,
      );
      return link;
    });
  }
  async history(supplierId: string, internalPartId?: string) {
    if (
      !(await this.db.client.supplier.findUnique({ where: { id: supplierId } }))
    )
      throw new NotFoundError("Supplier");
    const part = internalPartId ? { internalPartId } : {};
    const [
      qualifications,
      supplierQualifications,
      approvals,
      incoming,
      ncrs,
      scars,
      changes,
    ] = await Promise.all([
      this.db.client.productQualification.findMany({
        where: {
          supplierId,
          ...(internalPartId ? { supplierProduct: part } : {}),
        },
        include: { firstArticles: true, tests: true },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      this.db.client.supplierQualification.findMany({
        where: { supplierId },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      this.db.client.productApproval.findMany({
        where: { supplierId, ...part },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      this.db.client.incomingInspection.findMany({
        where: { supplierId, ...part },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      this.db.client.nonconformance.findMany({
        where: { supplierId, ...part },
        include: { defectLines: true, scarLinks: true },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      this.db.client.correctiveAction.findMany({
        where: {
          supplierId,
          ...(internalPartId
            ? {
                OR: [
                  { ncr: { internalPartId } },
                  { ncrLinks: { some: { ncr: { internalPartId } } } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      this.db.client.changeRequest.findMany({
        where: {
          supplierId,
          ...(internalPartId ? { supplierProduct: part } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
    ]);
    return {
      supplierId,
      internalPartId: internalPartId ?? null,
      supplierQualifications,
      qualifications,
      approvals,
      incoming,
      ncrs,
      scars,
      changes,
      includesClosed: true,
      unresolvedRecordsExcluded: true,
      maximumPerModule: 500,
    };
  }
}
