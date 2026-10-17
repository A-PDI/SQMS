import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { Prisma, type PrismaClient } from "@sqms/db";
import { ObjectStorage } from "@sqms/server-core";
import { signatureMatches } from "@sqms/shared";
import {
  seedItemSerials,
  normaliseSerial,
  injectorScorecard,
  hydrateInjectorRow,
  partKey,
  unitResolver,
  zonedTimeToInstant,
} from "@sqms/legacy-domain";
import {
  digest,
  object,
  inspectionItems,
} from "../modules/operations/operations.rules";
import type {
  DisposableTarget,
  Intake,
  LegacyRow,
  MigrationMappings,
  MigrationReport,
  MigrationOutcome,
} from "./types";
import { reconcileBusiness } from "./reconciliation";

const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
/** Deterministic target UUIDs retain an explicit source mapping while avoiding collisions with unrelated target data. */
export function migrationId(system: string, entity: string, source: string) {
  const h = createHash("sha256")
    .update(`${system}\0${entity}\0${source}`)
    .digest("hex")
    .slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20)}`;
}
function parseJson(value: unknown, fallback: any = {}) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Unresolved("Malformed legacy JSON; raw text retained");
  }
}
class Unresolved extends Error {}
type Tx = Prisma.TransactionClient;
type Result = {
  type: string;
  id: string | null;
  reason?: string;
  partial?: boolean;
};
const TABLES = [
  "users",
  "inspection_templates",
  "part_specs",
  "inspections",
  "ncrs",
  "ncr_sections",
  "inspection_notes",
  "inspection_activity_log",
  "quality_alerts",
  "saved_reports",
  "injector_test_reports",
  "injector_repair_cases",
  "injector_repair_attempts",
  "injector_repair_changes",
  "injector_repair_result_deltas",
  "inspection_attachments",
  "ncr_images",
  "engineering_drawings",
];

export class LegacyMigration {
  private readonly sourceIds = new Map<string, string>();
  private readonly revisions = new Map<string, LegacyRow>();
  private readonly parts = new Map<string, string>();
  constructor(
    private readonly db: PrismaClient,
    private readonly storage: ObjectStorage,
    private readonly target: DisposableTarget,
    private readonly mappings: MigrationMappings,
    private readonly actorId: string,
    private readonly organizationId: string,
    private readonly attachmentRoot?: string,
    private readonly enqueueScan?: (id: string) => Promise<void>,
  ) {}
  private id(table: string, source: string) {
    return migrationId(this.target.sourceSystem, table, source);
  }
  private async mapped(
    tx: Tx,
    entity: string,
    source: unknown,
  ): Promise<string | null> {
    if (!source) return null;
    const key = `${entity}:${source}`;
    if (this.sourceIds.has(key)) return this.sourceIds.get(key)!;
    const r = await tx.legacyRecord.findUnique({
      where: {
        sourceSystem_entity_sourceId: {
          sourceSystem: this.target.sourceSystem,
          entity,
          sourceId: String(source),
        },
      },
    });
    return r?.targetId ?? null;
  }
  private timestamp(
    intake: Intake,
    entity: string,
    row: LegacyRow,
    field: string,
  ): Date | undefined {
    const override =
      this.mappings.timestampOverrides?.[`${entity}:${row.id}:${field}`];
    const value = override ?? row[field];
    if (!value) return undefined;
    const text = String(value);
    if (/Z$|[+-]\d\d:\d\d$/.test(text)) {
      const d = new Date(text);
      return Number.isFinite(d.getTime()) ? d : undefined;
    }
    if (!intake.sourceTimezone) return undefined;
    const m =
      /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/.exec(
        text,
      );
    if (!m) return undefined;
    const instant = zonedTimeToInstant(
      m[1],
      { hour: Number(m[2]), minute: Number(m[3]), second: Number(m[4] ?? 0) },
      intake.sourceTimezone,
    );
    const format = new Intl.DateTimeFormat("en-CA", {
      timeZone: intake.sourceTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const wall = (date: Date) =>
      Object.fromEntries(
        format.formatToParts(date).map((p) => [p.type, p.value]),
      );
    const expected = `${m[1]} ${m[2]}:${m[3]}:${m[4] ?? "00"}`;
    const label = (date: Date) => {
      const p = wall(date);
      return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
    };
    if (
      label(instant) !== expected ||
      [-7200000, -3600000, -1800000, 1800000, 3600000, 7200000].some(
        (delta) => label(new Date(instant.getTime() + delta)) === expected,
      )
    )
      throw new Unresolved(
        "Ambiguous or nonexistent daylight-saving timestamp requires an explicit ISO timestamp override",
      );
    instant.setUTCMilliseconds(Number((m[5] ?? "0").padEnd(3, "0")));
    return instant;
  }
  private async part(tx: Tx, original: unknown, dry: boolean) {
    if (original == null || String(original).trim() === "") return null;
    const number = String(original); // Deliberately preserve punctuation, whitespace, case and leading zeroes.
    if (this.parts.has(number)) {
      const cached = this.parts.get(number)!;
      if (dry || (await tx.internalPart.findUnique({ where: { id: cached } })))
        return cached;
      this.parts.delete(number);
    }
    const reviewed = this.mappings.parts?.[number];
    if (reviewed) {
      if (!reviewed.reviewedById || reviewed.reason.trim().length < 5)
        throw new Unresolved("Part mapping lacks review evidence");
      if (
        !(await tx.internalPart.findUnique({
          where: { id: reviewed.targetId },
        }))
      )
        throw new Unresolved("Reviewed part mapping target is missing");
      this.parts.set(number, reviewed.targetId);
      return reviewed.targetId;
    }
    const existing = await tx.internalPart.findUnique({
      where: { partNumber: number },
    });
    if (existing && existing.partNumber !== number)
      throw new Unresolved(
        "Part identifier collides under database collation; a reviewed alias mapping is required",
      );
    if (number.length > 60)
      throw new Unresolved(
        "Part number exceeds the master field; retain original and supply a reviewed mapping",
      );
    const id = existing?.id ?? this.id("internal_part", number);
    if (!existing && !dry) {
      await tx.internalPart.create({
        data: {
          id,
          partNumber: number,
          description: "Legacy part — description pending master-data review",
          status: "DEVELOPMENT",
          notes:
            "Imported identifier only; supplier and product approvals are unresolved",
        },
      });
      await tx.externalReference.upsert({
        where: {
          system_entityType_externalId: {
            system: this.target.sourceSystem,
            entityType: "INTERNAL_PART",
            externalId: number,
          },
        },
        create: {
          system: this.target.sourceSystem,
          entityType: "INTERNAL_PART",
          externalId: number,
          entityId: id,
          metadata: {
            normalization:
              "Exact original identifier; no punctuation or leading-zero removal",
          },
        },
        update: {},
      });
    }
    this.parts.set(number, id);
    return id;
  }
  private async context(tx: Tx, entity: string, row: LegacyRow, dry: boolean) {
    const mapping = this.mappings.records?.[`${entity}:${row.id}`];
    if (mapping && (!mapping.reviewedById || mapping.reason.trim().length < 5))
      throw new Unresolved("Record mapping requires review evidence");
    let internalPartId =
      mapping?.internalPartId ?? (await this.part(tx, row.part_number, dry));
    let supplierId = mapping?.supplierId ?? null;
    let siteId: string | null = null;
    let supplierProductId: string | null = null;
    if (mapping?.supplierProductId) {
      const sp = await tx.supplierProduct.findUnique({
        where: { id: mapping.supplierProductId },
      });
      if (
        !sp ||
        (internalPartId && sp.internalPartId !== internalPartId) ||
        (supplierId && supplierId !== sp.supplierId)
      )
        throw new Unresolved(
          "Reviewed supplier-product mapping has inconsistent supplier/part ownership",
        );
      internalPartId = sp.internalPartId;
      supplierId = sp.supplierId;
      siteId = sp.siteId;
      supplierProductId = sp.id;
    }
    if (
      supplierId &&
      !(await tx.supplier.findUnique({ where: { id: supplierId } }))
    )
      throw new Unresolved("Mapped supplier does not exist");
    if (
      internalPartId &&
      !dry &&
      !(await tx.internalPart.findUnique({ where: { id: internalPartId } }))
    )
      throw new Unresolved("Mapped part does not exist");
    return { internalPartId, supplierId, siteId, supplierProductId };
  }
  private async targetValue(
    tx: Tx,
    type: string | null,
    id: string | null,
  ): Promise<unknown> {
    if (!id) return null;
    switch (type) {
      case "USER":
        return tx.user.findUnique({
          where: { id },
          include: { memberships: { include: { roles: true } } },
        });
      case "INSPECTION_PLAN_REVISION":
        return tx.inspectionPlanRevision.findUnique({ where: { id } });
      case "PART_SPEC":
        return tx.partInspectionSpecification.findUnique({ where: { id } });
      case "INCOMING_INSPECTION":
        return tx.incomingInspection.findUnique({
          where: { id },
          include: { items: true, measurements: true },
        });
      case "NCR":
        return tx.nonconformance.findUnique({ where: { id } });
      case "NCR_SECTION":
        return tx.ncrReportSection.findUnique({ where: { id } });
      case "ALERT":
        return tx.operationalAlert.findUnique({ where: { id } });
      case "INJECTOR_TEST":
        return tx.injectorTest.findUnique({ where: { id } });
      case "INJECTOR_REPAIR":
        return tx.injectorRepairCase.findUnique({ where: { id } });
      case "REPAIR_ATTEMPT":
        return tx.injectorRepairAttempt.findUnique({ where: { id } });
      case "FILE":
        return tx.fileObject.findUnique({
          where: { id },
          include: { attachments: true, revisionFiles: true },
        });
      case "DRAWING":
        return tx.documentRecord.findUnique({
          where: { id },
          include: { revisions: { include: { files: true } }, links: true },
        });
      case "SAVED_VIEW":
        return tx.savedView.findUnique({ where: { id } });
      default:
        return null;
    }
  }
  private fingerprint(value: unknown) {
    if (!value) return null;
    const copy = JSON.parse(
      JSON.stringify(value, (_key, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
    );
    for (const key of [
      "items",
      "measurements",
      "memberships",
      "attachments",
      "revisionFiles",
      "revisions",
      "links",
    ])
      if (Array.isArray(copy[key]))
        copy[key].sort((a: LegacyRow, b: LegacyRow) =>
          String(a.id).localeCompare(String(b.id)),
        );
    for (const membership of copy.memberships ?? [])
      membership.roles?.sort((a: LegacyRow, b: LegacyRow) =>
        String(a.roleId).localeCompare(String(b.roleId)),
      );
    // Scanning changes availability, not the imported evidence bytes or associations.
    if (copy.storageKey)
      for (const k of [
        "status",
        "scanEngine",
        "scanSignature",
        "scanAttempts",
        "scannedAt",
        "updatedAt",
      ])
        delete copy[k];
    return digest(copy);
  }
  private async repairSnapshot(
    tx: Tx,
    intake: Intake,
    table: string,
    row: LegacyRow,
    prefix: string,
  ) {
    const cached = (intake.tables.injector_test_reports ?? []).find(
      (r) =>
        r.id === row[`${prefix}_test_id`] ||
        (r.report_ext_id === row[`${prefix}_report_ext_id`] &&
          Number(r.slot_position) === Number(row[`${prefix}_slot_position`])),
    );
    const testAt = this.timestamp(
      intake,
      table,
      row,
      `${prefix}_test_datetime`,
    );
    const relatedAt = cached
      ? this.timestamp(intake, "injector_test_reports", cached, "test_datetime")
      : undefined;
    return {
      ...(cached ? hydrateInjectorRow(cached) : {}),
      id: cached
        ? await this.mapped(tx, "injector_test_reports", cached.id)
        : null,
      part_number: row.part_number ?? cached?.part_number ?? null,
      serial_number: row.serial_number ?? cached?.serial_number ?? null,
      report_ext_id:
        row[`${prefix}_report_ext_id`] ?? cached?.report_ext_id ?? null,
      slot_position:
        row[`${prefix}_slot_position`] ?? cached?.slot_position ?? null,
      test_datetime: (testAt ?? relatedAt)?.toISOString() ?? null,
      originalTimestamp:
        row[`${prefix}_test_datetime`] ?? cached?.test_datetime ?? null,
      result_status:
        row[`${prefix}_result_status`] ?? cached?.result_status ?? "UNKNOWN",
      legacy: true,
      unavailableMeasurementSnapshot: !cached,
    };
  }
  private async transform(
    tx: Tx,
    intake: Intake,
    table: string,
    row: LegacyRow,
    dry: boolean,
    sourceHash: string,
  ): Promise<Result> {
    const sourceId = String(row.id);
    const id = this.id(table, sourceId);
    const createdAt = this.timestamp(intake, table, row, "created_at");
    if (table === "users") {
      const reviewed = this.mappings.users?.[sourceId];
      if (reviewed) {
        if (
          !reviewed.reviewedById ||
          reviewed.reason.trim().length < 5 ||
          !(await tx.user.findFirst({
            where: { id: reviewed.targetId, userType: "INTERNAL" },
          }))
        )
          throw new Unresolved(
            "Account identity mapping is missing or unreviewed",
          );
        return {
          type: "USER",
          id: reviewed.targetId,
          reason:
            "Ownership mapped to existing internal account; its credentials and grants retained",
        };
      }
      const roleMap = this.mappings.roles?.[String(row.role)];
      if (!roleMap || !roleMap.reviewedById || roleMap.reason.trim().length < 5)
        throw new Unresolved("Reviewed local-role mapping required");
      if (
        row.permissions &&
        !["{}", "[]", "null"].includes(String(row.permissions))
      )
        throw new Unresolved(
          "Custom per-user page permissions require an explicit reviewed user mapping",
        );
      const roles = await tx.role.findMany({
        where: { key: { in: roleMap.roleKeys }, scope: "INTERNAL" },
      });
      if (!roles.length || roles.length !== roleMap.roleKeys.length)
        throw new Unresolved(
          "Role mapping references missing or external roles",
        );
      if (
        (row.role === "qc_manager" || row.role === "inspector") &&
        roles.some((r) => r.key === "SYSTEM_ADMIN")
      )
        throw new Unresolved(
          "Ordinary Quality roles cannot implicitly gain user administration",
        );
      const email = String(row.email ?? "")
        .trim()
        .toLowerCase();
      if (!email.includes("@"))
        throw new Unresolved(
          "Invalid legacy account identity; administrator review required",
        );
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing && existing.id !== id)
        throw new Unresolved(
          "Duplicate email requires a reviewed account merge mapping",
        );
      const hash =
        typeof row.password_hash === "string" &&
        /^\$2[aby]\$\d{2}\$/.test(row.password_hash)
          ? row.password_hash
          : null;
      if (!dry)
        await tx.user.upsert({
          where: { id },
          create: {
            id,
            email,
            displayName: String(row.name ?? email),
            userType: "INTERNAL",
            status: row.active ? "ACTIVE" : "DISABLED",
            passwordHash: hash,
            createdAt,
            memberships: {
              create: {
                organizationId: this.organizationId,
                roles: { create: roles.map((r) => ({ roleId: r.id })) },
              },
            },
          },
          update: {
            displayName: String(row.name ?? email),
            status: row.active ? "ACTIVE" : "DISABLED",
            passwordHash: hash,
          },
        });
      if (!dry) {
        const membership = await tx.organizationMembership.findUniqueOrThrow({
          where: {
            userId_organizationId: {
              userId: id,
              organizationId: this.organizationId,
            },
          },
        });
        await tx.membershipRole.deleteMany({
          where: { membershipId: membership.id },
        });
        await tx.membershipRole.createMany({
          data: roles.map((r) => ({
            membershipId: membership.id,
            roleId: r.id,
          })),
        });
      }
      return {
        type: "USER",
        id,
        reason: hash
          ? undefined
          : "Legacy credential format unavailable; documented password reset required",
        partial: !hash,
      };
    }
    if (table === "inspection_templates") {
      const definition = {
        ...row,
        header_schema: parseJson(row.header_schema, []),
        sections: parseJson(row.sections),
        capturedAtExport: true,
        historicalDefinitionVersionUnknown: true,
      };
      const planId = this.id("inspection_plan", sourceId);
      const revisionId = this.id(
        "inspection_plan_revision",
        sourceId + ":" + sourceHash,
      );
      const latest = await tx.inspectionPlanRevision.findFirst({
        where: { planId },
        orderBy: { revision: "desc" },
      });
      if (!dry) {
        await tx.inspectionPlan.upsert({
          where: { id: planId },
          create: {
            id: planId,
            code: `LEGACY-${String(row.form_no).slice(0, 30)}-${id.slice(0, 8)}`,
            title: row.title,
          },
          update: {},
        });
        await tx.inspectionPlanRevision.upsert({
          where: { id: revisionId },
          create: {
            id: revisionId,
            planId,
            revision: (latest?.revision ?? 0) + 1,
            status: "RELEASED",
            definition: json(definition),
            definitionHash: digest(definition),
            legacyVersionUnknown: true,
          },
          update: {},
        });
      }
      this.revisions.set(sourceId, { id: revisionId, definition });
      return { type: "INSPECTION_PLAN_REVISION", id: revisionId };
    }
    if (table === "part_specs") {
      const internalPartId = await this.part(tx, row.part_number, dry);
      const planRevisionId = await this.mapped(
        tx,
        "inspection_templates",
        row.template_id,
      );
      if (!internalPartId || !planRevisionId)
        throw new Unresolved(
          "Part specification requires resolved template and part",
        );
      if (!dry)
        await tx.partInspectionSpecification.upsert({
          where: { id },
          create: {
            id,
            internalPartId,
            planRevisionId,
            data: json(parseJson(row.spec_data)),
          },
          update: {
            data: json(parseJson(row.spec_data)),
            version: { increment: 1 },
          },
        });
      return { type: "PART_SPEC", id };
    }
    if (table === "inspections") {
      const planRevisionId = await this.mapped(
        tx,
        "inspection_templates",
        row.template_id,
      );
      if (!planRevisionId)
        throw new Unresolved("Inspection template has not been mapped");
      const cached = this.revisions.get(String(row.template_id));
      const plan =
        cached ??
        (await tx.inspectionPlanRevision.findUnique({
          where: { id: planRevisionId },
        }));
      if (!plan)
        throw new Unresolved("Inspection plan revision is unavailable");
      const sectionData = parseJson(row.section_data);
      const definition = object(plan.definition);
      const count =
        Array.isArray(sectionData.__items) && sectionData.__items.length
          ? sectionData.__items.length
          : Math.max(1, Number(row.item_count) || 1);
      if (count > 500)
        throw new Unresolved(
          "Inspection item count exceeds the execution limit; raw history preserved",
        );
      const items = seedItemSerials(
        inspectionItems(sectionData, count),
        String(row.lot_serial_no ?? ""),
      );
      const refs = await this.context(tx, table, row, dry);
      const owner = await this.mapped(tx, "users", row.created_by);
      const assigned = await this.mapped(tx, "users", row.assigned_to);
      const knownStatus: Record<string, "DRAFT" | "IN_PROGRESS" | "COMPLETE"> =
        {
          draft: "DRAFT",
          partially_complete: "IN_PROGRESS",
          in_progress: "IN_PROGRESS",
          complete: "COMPLETE",
          approved: "COMPLETE",
          rejected: "COMPLETE",
          submitted: "COMPLETE",
        };
      if (!knownStatus[row.status])
        throw new Unresolved(
          "Unknown inspection status; review mapping without running legacy startup rewrites",
        );
      const reasons = [
        !refs.supplierId
          ? "Supplier/site unresolved; no supplier inferred from part"
          : "",
        !createdAt ? "Original timestamp zone unknown" : "",
        !sectionData.__admin_sections
          ? "Template captured at export; historical template version unknown"
          : "",
      ].filter(Boolean);
      const data = {
        number: String(row.inspection_number ?? `LEGACY-${sourceId}`).slice(
          0,
          80,
        ),
        planRevisionId,
        planSnapshot: json({
          ...definition,
          sections: sectionData.__admin_sections ?? definition.sections,
          historicalDefinitionVersionUnknown: !sectionData.__admin_sections,
        }),
        ...refs,
        createdAtKnown: !!createdAt,
        originalPartNumber: row.part_number || null,
        originalSupplier: row.supplier || null,
        resolutionNotes: reasons.join("; "),
        receivedDate: /^\d{4}-\d{2}-\d{2}$/.test(
          String(row.date_received ?? ""),
        )
          ? new Date(row.date_received + "T00:00:00Z")
          : null,
        header: json(
          Object.fromEntries(
            Object.entries(row).filter(([k]) => !["section_data"].includes(k)),
          ),
        ),
        sectionData: json(sectionData),
        status: knownStatus[row.status],
        disposition: row.disposition || null,
        itemCount: count,
        assignedToId: assigned,
        completedAt: this.timestamp(intake, table, row, "completed_at"),
        completedById: await this.mapped(tx, "users", row.submitted_by),
        createdById: owner,
        ...(createdAt ? { createdAt } : {}),
      };
      if (!dry) {
        await tx.incomingInspection.upsert({
          where: { id },
          create: { id, ...data },
          update: { ...data, version: { increment: 1 } },
        });
        for (let position = 0; position < count; position++)
          await tx.incomingItem.upsert({
            where: { inspectionId_position: { inspectionId: id, position } },
            create: {
              id: this.id("inspection_item", sourceId + ":" + position),
              inspectionId: id,
              position,
              serialNumber: items[position].__serial_no || null,
              results: json(items[position]),
            },
            update: {
              serialNumber: items[position].__serial_no || null,
              results: json(items[position]),
            },
          });
      }
      return {
        type: "INCOMING_INSPECTION",
        id,
        reason: reasons.join("; ") || undefined,
        partial: reasons.length > 0,
      };
    }
    if (table === "ncrs") {
      const refs = await this.context(tx, table, row, dry);
      const incomingInspectionId = await this.mapped(
        tx,
        "inspections",
        row.inspection_id,
      );
      const statuses: Record<
        string,
        "OPEN" | "UNDER_INVESTIGATION" | "CLOSED" | "DISPOSITIONED"
      > = {
        open: "OPEN",
        in_progress: "UNDER_INVESTIGATION",
        closed: "CLOSED",
        dispositioned: "DISPOSITIONED",
      };
      const dispositions: Record<string, any> = {
        accepted_as_is: "USE_AS_IS_CONCESSION",
        use_as_is: "USE_AS_IS_CONCESSION",
        rework: "REWORK",
        repair: "REPAIR",
        return_to_supplier: "RETURN_TO_SUPPLIER",
        scrap: "SCRAP",
        hold: "HOLD",
      };
      if (!statuses[row.status])
        throw new Unresolved("Unrecognized historical NCR status");
      const identified = /^\d{4}-\d{2}-\d{2}/.exec(
        String(row.created_at ?? ""),
      )?.[0];
      if (!identified)
        throw new Unresolved(
          "NCR date is unknown; preserve raw record for reviewed date mapping",
        );
      if (
        !["MINOR", "MAJOR", "CRITICAL"].includes(
          String(row.severity).toUpperCase(),
        )
      )
        throw new Unresolved(
          "Unknown historical NCR severity; reviewed mapping required",
        );
      const data = {
        number: String(row.ncr_number),
        title: String(
          row.description_of_defect ?? "Historical nonconformance",
        ).slice(0, 250),
        dateIdentified: new Date(identified + "T00:00:00Z"),
        source: incomingInspectionId
          ? ("INCOMING_INSPECTION" as const)
          : ("OTHER" as const),
        ...refs,
        incomingInspectionId,
        purchaseOrder: row.po_number || null,
        quantityAffected:
          row.quantity_affected == null ? null : Number(row.quantity_affected),
        defectDescription: String(row.description_of_defect ?? ""),
        severity: ["MINOR", "MAJOR", "CRITICAL"].includes(
          String(row.severity).toUpperCase(),
        )
          ? (String(row.severity).toUpperCase() as
              | "MINOR"
              | "MAJOR"
              | "CRITICAL")
          : "MAJOR",
        status: statuses[row.status],
        disposition: dispositions[row.ncr_disposition] ?? null,
        ownerId: await this.mapped(tx, "users", row.created_by),
        createdById: await this.mapped(tx, "users", row.created_by),
        blocksApproval: !["CLOSED", "DISPOSITIONED"].includes(
          statuses[row.status],
        ),
        supplierVisible: false,
        closedAt: this.timestamp(intake, table, row, "closed_at"),
        ...(createdAt ? { createdAt } : {}),
        legacyException: json({
          sourceId,
          originalDisposition: row.ncr_disposition,
          originalSeverity: row.severity,
          missingHistoricalApprovals: true,
          sourceTimezone: intake.sourceTimezone ?? "UNKNOWN",
          originalCreatedAt: row.created_at,
          originalCreatorName: row.created_by_name,
          originalSupplier: row.supplier ?? null,
          originalPartNumber: row.part_number ?? null,
          quantityUnknown: row.quantity_affected == null,
        }),
      };
      if (!dry)
        await tx.nonconformance.upsert({
          where: { id },
          create: { id, ...data },
          update: { ...data, version: { increment: 1 } },
        });
      return {
        type: "NCR",
        id,
        partial: !refs.supplierId,
        reason: !refs.supplierId
          ? "Unattributed legacy NCR; no historical approval or supplier invented"
          : undefined,
      };
    }
    if (table === "ncr_sections") {
      const ncrId = await this.mapped(tx, "ncrs", row.ncr_id);
      if (!ncrId)
        throw new Unresolved("NCR report section has an unresolved parent");
      const data = {
        ncrId,
        title: String(row.title ?? ""),
        body: String(row.body ?? ""),
        sortOrder: Number(row.sort_order) || 0,
      };
      if (!dry)
        await tx.ncrReportSection.upsert({
          where: { id },
          create: { id, ...data },
          update: data,
        });
      return { type: "NCR_SECTION", id };
    }
    if (table === "quality_alerts") {
      const inspectionId = await this.mapped(
        tx,
        "inspections",
        row.inspection_id,
      );
      if (row.inspection_id && !inspectionId)
        throw new Unresolved("Historical alert has no resolved inspection");
      const ordinal = intake.tables.quality_alerts
        .filter((r) => r.inspection_id === row.inspection_id)
        .findIndex((r) => String(r.id) === sourceId);
      const data = {
        inspectionId,
        originalPartNumber: row.part_number || null,
        originalSupplier: row.supplier || null,
        triggeredById: await this.mapped(tx, "users", row.triggered_by),
        completionVersion: -1 - ordinal,
        type: String(row.alert_type ?? "legacy_alert"),
        notes: row.notes || null,
        acknowledgedById: await this.mapped(tx, "users", row.acknowledged_by),
        acknowledgedAt: this.timestamp(intake, table, row, "acknowledged_at"),
        ...(createdAt ? { createdAt } : {}),
      };
      if (!dry)
        await tx.operationalAlert.upsert({
          where: { id },
          create: { id, ...data },
          update: data,
        });
      return { type: "ALERT", id };
    }
    if (table === "injector_test_reports") {
      const r = hydrateInjectorRow(row);
      const score = injectorScorecard(r);
      if (!row.report_ext_id || !Number.isInteger(Number(row.slot_position)))
        throw new Unresolved("Injector report identity is missing");
      const data = {
        reportExternalId: String(row.report_ext_id),
        slotPosition: Number(row.slot_position),
        partNumber: row.part_number || null,
        serialNumber: row.serial_number || null,
        normalizedSerial: row.serial_number
          ? normaliseSerial(String(row.serial_number))
          : null,
        jobNumber: row.job_number || null,
        testAt: this.timestamp(intake, table, row, "test_datetime"),
        outcome: score.outcome,
        stepsTotal: score.stepsTotal,
        stepsPassed: score.stepsPassed,
        stepsFailed: score.stepsFailed,
        report: json({
          ...parseJson(row.report_json),
          brand: row.brand,
          machine_name: row.machine_name,
          machine_sn: row.machine_sn,
          tests: r.tests,
        }),
        sourceHash,
      };
      if (!dry)
        await tx.injectorTest.upsert({
          where: { id },
          create: { id, ...data },
          update: { ...data, version: { increment: 1 } },
        });
      return {
        type: "INJECTOR_TEST",
        id,
        partial: !data.testAt,
        reason: !data.testAt
          ? "Historical test timezone unresolved"
          : undefined,
      };
    }
    if (table === "injector_repair_cases") {
      if (!row.serial_number)
        throw new Unresolved("Repair case serial identity missing");
      const normalizedSerial = unitResolver(
        (intake.tables.injector_test_reports ?? [])
          .filter(
            (r) =>
              partKey(r.part_number ?? "") === partKey(row.part_number ?? ""),
          )
          .map((r) => r.serial_number ?? "")
          .concat(row.serial_number),
      )(row.serial_number);
      const status = String(row.status);
      const data = {
        partNumber: String(row.part_number ?? ""),
        serialNumber: String(row.serial_number),
        normalizedSerial,
        status,
        activeKey: ["OPEN", "HOLD", "ENGINEERING_REVIEW"].includes(status)
          ? digest([partKey(row.part_number ?? ""), normalizedSerial])
          : null,
        initialTestSnapshot: json(
          await this.repairSnapshot(tx, intake, table, row, "initial"),
        ),
        finalTestSnapshot: row.final_report_ext_id
          ? json(await this.repairSnapshot(tx, intake, table, row, "final"))
          : Prisma.JsonNull,
        failureCategories: json(parseJson(row.failure_categories_json, [])),
        openedById: await this.mapped(tx, "users", row.opened_by),
        openedAt: this.timestamp(intake, table, row, "opened_at"),
        closedById: await this.mapped(tx, "users", row.closed_by),
        closedAt: this.timestamp(intake, table, row, "closed_at"),
      };
      if (!dry)
        await tx.injectorRepairCase.upsert({
          where: { id },
          create: { id, ...data },
          update: { ...data, version: { increment: 1 } },
        });
      return {
        type: "INJECTOR_REPAIR",
        id,
        partial: !data.openedAt,
        reason: !data.openedAt
          ? "Original repair opening time zone unknown; raw date retained"
          : undefined,
      };
    }
    if (table === "injector_repair_attempts") {
      const repairCaseId = await this.mapped(
        tx,
        "injector_repair_cases",
        row.repair_case_id,
      );
      if (!repairCaseId)
        throw new Unresolved("Repair attempt parent is unresolved");
      const changes = (intake.tables.injector_repair_changes ?? []).filter(
        (r) => r.repair_attempt_id === row.id,
      );
      const deltas = (intake.tables.injector_repair_result_deltas ?? []).filter(
        (r) => r.repair_attempt_id === row.id,
      );
      const repairDate =
        this.timestamp(intake, table, row, "repair_date") ??
        (/^\d{4}-\d{2}-\d{2}$/.test(row.repair_date ?? "")
          ? new Date(row.repair_date + "T00:00:00Z")
          : undefined);
      if (!repairDate)
        throw new Unresolved(
          "Repair date requires a known timestamp or date-only mapping",
        );
      const data = {
        repairCaseId,
        attemptNumber: Number(row.attempt_number),
        beforeSnapshot: json(
          await this.repairSnapshot(tx, intake, table, row, "before"),
        ),
        afterSnapshot: row.after_report_ext_id
          ? json(await this.repairSnapshot(tx, intake, table, row, "after"))
          : Prisma.JsonNull,
        repairDate,
        technician: String(row.technician ?? "Unknown historical technician"),
        technicianId: await this.mapped(tx, "users", row.technician_id),
        diagnosis: String(row.diagnosis ?? ""),
        hypothesis: row.hypothesis || null,
        expectedOutcome: row.expected_outcome || null,
        observedOutcome: row.observed_outcome || null,
        notes: row.repair_notes || null,
        changes: json(changes),
        deltas: json(deltas),
        status: String(row.status),
        outcome: String(row.outcome),
        ...(createdAt ? { createdAt } : {}),
      };
      if (!dry)
        await tx.injectorRepairAttempt.upsert({
          where: { id },
          create: { id, ...data },
          update: { ...data, version: { increment: 1 } },
        });
      return { type: "REPAIR_ATTEMPT", id };
    }
    if (
      ["inspection_attachments", "ncr_images", "engineering_drawings"].includes(
        table,
      )
    )
      return this.file(tx, intake, table, row, dry);
    if (table === "saved_reports") {
      const userId = await this.mapped(tx, "users", row.created_by);
      if (!userId)
        throw new Unresolved("Saved report owner requires an account mapping");
      let old = parseJson(row.config_json);
      if (typeof old === "string") old = parseJson(old);
      if (!old || typeof old !== "object" || Array.isArray(old))
        throw new Unresolved(
          "Saved report configuration must resolve to an object; original text retained",
        );
      const value = (input: unknown) =>
        input == null || String(input).toLowerCase() === "all"
          ? ""
          : String(input);
      const statuses: LegacyRow = {
        draft: "DRAFT",
        open: "DRAFT",
        complete: "COMPLETE",
        completed: "COMPLETE",
        partially_complete: "IN_PROGRESS",
      };
      const planRevisionId = await this.mapped(
        tx,
        "inspection_templates",
        value(old.template_id),
      );
      const revision = planRevisionId
        ? await tx.inspectionPlanRevision.findUnique({
            where: { id: planRevisionId },
          })
        : null;
      const filters = {
        dateFrom: value(old.date_from),
        dateTo: value(old.date_to),
        status: statuses[String(old.status ?? "").toLowerCase()] || "",
        disposition: value(old.disposition),
        componentType: value(old.component_type),
        assignedToId: (await this.mapped(tx, "users", old.assigned_to)) || "",
        planId: revision?.planId || "",
        groupBy:
          old.group_by === "component_type"
            ? "component"
            : old.group_by === "assigned_to"
              ? "assignee"
              : old.group_by || "all",
      };
      const data = {
        userId,
        module: "inspection-reports",
        name: String(row.name).slice(0, 100) + ` [${id.slice(0, 8)}]`,
        filters,
        ...(createdAt ? { createdAt } : {}),
      };
      if (!dry)
        await tx.savedView.upsert({
          where: { id },
          create: { id, ...data },
          update: data,
        });
      return {
        type: "SAVED_VIEW",
        id,
        partial: !!value(old.template_id) && !revision,
        reason:
          value(old.template_id) && !revision
            ? "Saved report plan filter requires review; original config retained"
            : undefined,
      };
    }
    // Notes, activity, saved reports, original repair changes and deltas are preserved as credential-free legacy history.
    return {
      type: "LEGACY_HISTORY",
      id: null,
      reason:
        "Original legacy history retained separately from native audit events",
    };
  }
  private async file(
    tx: Tx,
    intake: Intake,
    table: string,
    row: LegacyRow,
    dry: boolean,
  ): Promise<Result> {
    const entry = intake.files.find(
      (f) => f.entity === table && f.sourceId === String(row.id),
    );
    if (
      !entry ||
      entry.status !== "READY" ||
      !entry.relativePath ||
      !entry.sha256 ||
      !this.attachmentRoot
    )
      throw new Unresolved(
        "Copied attachment is missing or lacks a reviewed path mapping",
      );
    const root = await realpath(this.attachmentRoot);
    const actual = await realpath(path.resolve(root, entry.relativePath));
    if (!actual.startsWith(root + path.sep))
      throw new Unresolved("Attachment escapes the copied file root");
    const bytes = await readFile(actual);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== entry.sha256 || bytes.length !== entry.sizeBytes)
      throw new Unresolved("Attachment bytes changed after immutable intake");
    const id = this.id("file", table + ":" + row.id + ":" + sha256);
    const storageKey = `legacy/${this.target.sourceSystem}/${id}/${sha256}`;
    const filename = String(row.file_name ?? "legacy-file")
      .replace(/[\\/\x00-\x1f]/g, "_")
      .slice(0, 255);
    const extension = path.extname(filename).slice(1).toLowerCase();
    const fileType = await tx.allowedFileType.findUnique({
      where: { extension },
    });
    if (!fileType?.enabled)
      throw new Unresolved(
        "Legacy file type requires a reviewed storage policy; source file retained",
      );
    if (!signatureMatches(extension, bytes.subarray(0, 8192)))
      throw new Unresolved(
        "Legacy file signature does not match its extension; source retained for review",
      );
    if (
      !bytes.length ||
      bytes.length > (fileType.maxSizeMb ?? 250) * 1024 * 1024
    )
      throw new Unresolved(
        "Legacy file exceeds the configured size limit or is empty",
      );
    const contentType =
      (fileType.mimeTypes as string[])[0] ?? "application/octet-stream";
    let entityType: "INCOMING_INSPECTION" | "NCR" | "INTERNAL_PART" =
      table === "inspection_attachments"
        ? "INCOMING_INSPECTION"
        : table === "ncr_images"
          ? "NCR"
          : "INTERNAL_PART";
    let entityId =
      table === "inspection_attachments"
        ? await this.mapped(tx, "inspections", row.inspection_id)
        : table === "ncr_images"
          ? await this.mapped(tx, "ncrs", row.ncr_id)
          : await this.part(tx, row.part_number, dry);
    if (!entityId)
      throw new Unresolved("File association parent is unresolved");
    if (!dry) {
      // Upload by content-derived key is repeatable. An interrupted transaction leaves a harmless private object that is reused.
      if (!(await this.storage.exists(storageKey)))
        await this.storage.putStream(
          storageKey,
          createReadStream(actual),
          contentType,
        );
      await tx.fileObject.upsert({
        where: { id },
        create: {
          id,
          bucket: this.storage.bucket,
          storageKey,
          originalFilename: String(row.file_name ?? filename),
          safeFilename: filename,
          extension,
          declaredContentType: contentType,
          contentType,
          category: fileType.category,
          sizeBytes: bytes.length,
          sha256,
          status: "QUARANTINED",
          uploadedById: this.actorId,
          ownerOrganizationId: this.organizationId,
          description: String(
            row.caption ?? row.notes ?? "Legacy evidence",
          ).slice(0, 500),
        },
        update: {},
      });
      const attId = this.id("attachment", table + ":" + row.id + ":" + sha256);
      const namespaced = /^item(\d+)__(.*)$/.exec(
        String(row.section_key ?? ""),
      );
      const sectionKey = namespaced ? namespaced[2] : (row.section_key ?? null);
      const itemPosition =
        table === "inspection_attachments"
          ? namespaced
            ? Number(namespaced[1])
            : sectionKey === "receiving"
              ? null
              : 0
          : null;
      await tx.recordAttachment.upsert({
        where: { id: attId },
        create: {
          id: attId,
          entityType,
          entityId,
          fileObjectId: id,
          description: String(row.caption ?? row.notes ?? "").slice(0, 500),
          addedById: this.actorId,
          visibility: "INTERNAL",
          context: json({
            sectionKey,
            itemPosition,
            rowId: row.item_id == null ? null : String(row.item_id),
            reportSectionId: await this.mapped(
              tx,
              "ncr_sections",
              row.section_id,
            ),
            legacySourceId: row.id,
            originalVersion: row.version ?? null,
            originalCurrent: row.is_current ?? null,
          }),
        },
        update: {},
      });
      if (
        table === "engineering_drawings" &&
        this.mappings.drawingDocumentTypeId
      ) {
        const mapping = this.mappings.drawingDocumentTypeId;
        if (
          !mapping.reviewedById ||
          mapping.reason.trim().length < 5 ||
          !(await tx.documentType.findUnique({
            where: { id: mapping.targetId },
          }))
        )
          throw new Unresolved(
            "Drawing document-type mapping requires a real catalog entry and review evidence",
          );
        const documentId = this.id("drawing_document", entityId);
        const revisionId = this.id(
          "drawing_revision",
          `${row.id}:${sha256}:${digest(row)}`,
        );
        const document = await tx.documentRecord.upsert({
          where: { id: documentId },
          create: {
            id: documentId,
            docNumber: `LDWG-${documentId.slice(0, 8)}`,
            documentTypeId: mapping.targetId,
            title: `Historical drawing: ${row.part_number}`,
            description:
              "Imported historical files; release/approval remains pending controlled-document review",
            ownerOrganizationId: this.organizationId,
            createdById: this.actorId,
            status: "DRAFT",
          },
          update: {},
        });
        const existingRevision = await tx.documentRevision.findUnique({
          where: { id: revisionId },
        });
        if (!existingRevision) {
          const last = await tx.documentRevision.findFirst({
            where: { documentId },
            orderBy: { revisionNumber: "desc" },
          });
          const sequence = (last?.revisionNumber ?? 0) + 1;
          await tx.documentRevision.create({
            data: {
              id: revisionId,
              documentId,
              revisionNumber: sequence,
              revisionLabel: `L${sequence}`,
              submissionMethod: "UPLOAD",
              createdById: this.actorId,
              status: "DRAFT",
              changeSummary: `Historical import. Original version: ${row.version ?? "unknown"}. Original current marker: ${row.is_current ?? "unknown"}. No historical approval invented.`,
            },
          });
        }
        await tx.documentRevisionFile.upsert({
          where: { revisionId_fileObjectId: { revisionId, fileObjectId: id } },
          create: { revisionId, fileObjectId: id, addedById: this.actorId },
          update: {},
        });
        await tx.documentLink.upsert({
          where: {
            documentId_entityType_entityId_linkRole: {
              documentId,
              entityType: "INTERNAL_PART",
              entityId,
              linkRole: "DRAWING",
            },
          },
          create: {
            documentId,
            entityType: "INTERNAL_PART",
            entityId,
            linkRole: "DRAWING",
            createdById: this.actorId,
          },
          update: {},
        });
        if (!document.latestRevisionId || row.is_current)
          await tx.documentRecord.update({
            where: { id: documentId },
            data: { latestRevisionId: revisionId },
          });
      }
    }
    return {
      type: "FILE",
      id,
      partial:
        table === "engineering_drawings" &&
        !this.mappings.drawingDocumentTypeId,
      reason:
        table === "engineering_drawings"
          ? this.mappings.drawingDocumentTypeId
            ? "Historical drawing files grouped into draft controlled revisions; release remains a human review"
            : "Historical drawing attached to the canonical part; controlled-document type/release mapping requires register review"
          : undefined,
    };
  }
  async run(
    intake: Intake,
    mode: "dry-run" | "import" | "validate",
  ): Promise<MigrationReport> {
    if (intake.formatVersion !== 1)
      throw new Error("Unsupported intake version");
    const start = Date.now();
    const report: MigrationReport = {
      datasetId: intake.datasetId,
      sourceHash: intake.sourceSha256,
      mode,
      fixtureOnly: /fixture|seed|synthetic/i.test(intake.datasetId),
      records: [],
      totals: {},
      sourceCounts: Object.fromEntries(
        Object.entries(intake.tables).map(([k, v]) => [k, v.length]),
      ),
      targetCounts: {},
      durationMs: 0,
      sourceTimezone: intake.sourceTimezone ?? "UNKNOWN",
    };
    for (const table of TABLES)
      for (const row of intake.tables[table] ?? []) {
        const sourceId = String(row.id);
        const key = `${table}:${sourceId}`;
        const snapshot = { ...row };
        if (table === "users") delete snapshot.password_hash;
        const sourceHash = digest({
          row,
          mapping: {
            record: this.mappings.records?.[key],
            user:
              table === "users" ? this.mappings.users?.[sourceId] : undefined,
            role:
              table === "users"
                ? this.mappings.roles?.[String(row.role)]
                : undefined,
            part: this.mappings.parts?.[String(row.part_number)],
            drawingType:
              table === "engineering_drawings"
                ? this.mappings.drawingDocumentTypeId
                : undefined,
            timestamps: Object.fromEntries(
              Object.entries(this.mappings.timestampOverrides ?? {}).filter(
                ([k]) => k.startsWith(key + ":"),
              ),
            ),
          },
          file:
            intake.files.find(
              (f) => f.entity === table && f.sourceId === sourceId,
            ) ?? null,
          ...(table === "injector_repair_attempts"
            ? {
                changes: (intake.tables.injector_repair_changes ?? []).filter(
                  (r) => r.repair_attempt_id === row.id,
                ),
                deltas: (
                  intake.tables.injector_repair_result_deltas ?? []
                ).filter((r) => r.repair_attempt_id === row.id),
              }
            : {}),
        });
        let outcome: MigrationOutcome = "MAPPED";
        let result: Result = { type: "LEGACY_HISTORY", id: null };
        try {
          await this.db.$transaction(
            async (tx) => {
              const unique = {
                sourceSystem: this.target.sourceSystem,
                entity: table,
                sourceId,
              };
              const existing = await tx.legacyRecord.findUnique({
                where: { sourceSystem_entity_sourceId: unique },
              });
              const currentHash = existing?.targetId
                ? this.fingerprint(
                    await this.targetValue(
                      tx,
                      existing.targetType,
                      existing.targetId,
                    ),
                  )
                : null;
              if (
                existing?.targetHash &&
                currentHash !== existing.targetHash &&
                !this.mappings.overwriteTestEdits?.[key]
              ) {
                outcome = "CONFLICT";
                result = {
                  type: existing.targetType ?? "LEGACY_HISTORY",
                  id: existing.targetId,
                  reason:
                    "Target changed during testing; preserved pending an explicit reviewed overwrite or mapping",
                };
                return;
              }
              const overwrite = this.mappings.overwriteTestEdits?.[key];
              if (
                overwrite &&
                (!overwrite.reviewedById || overwrite.reason.trim().length < 5)
              )
                throw new Unresolved(
                  "Overwrite exception lacks review evidence",
                );
              if (
                existing?.sourceHash === sourceHash &&
                (existing.targetId || existing.status === "MAPPED") &&
                !overwrite
              ) {
                outcome = "UNCHANGED";
                result = {
                  type: existing.targetType ?? "LEGACY_HISTORY",
                  id: existing.targetId,
                  reason: existing.reason ?? undefined,
                };
                if (existing.targetId)
                  this.sourceIds.set(key, existing.targetId);
                if (table === "inspection_templates" && existing.targetId) {
                  const revision = await tx.inspectionPlanRevision.findUnique({
                    where: { id: existing.targetId },
                  });
                  if (revision) this.revisions.set(sourceId, revision);
                }
                return;
              }
              if (mode === "validate") {
                outcome = "UNRESOLVED";
                result.reason = existing
                  ? "Source differs from imported baseline"
                  : "Source record has not been imported";
                return;
              }
              result = await this.transform(
                tx,
                intake,
                table,
                row,
                mode === "dry-run",
                sourceHash,
              );
              if (result.id) this.sourceIds.set(key, result.id);
              if (result.partial) outcome = "UNRESOLVED";
              if (mode === "import") {
                const targetHash = this.fingerprint(
                  await this.targetValue(tx, result.type, result.id),
                );
                const data = {
                  sourceHash,
                  snapshot: json(snapshot),
                  targetType: result.type,
                  targetId: result.id,
                  targetHash,
                  status: outcome,
                  reason: result.reason ?? null,
                };
                await tx.legacyRecord.upsert({
                  where: { sourceSystem_entity_sourceId: unique },
                  create: { ...unique, ...data },
                  update: data,
                });
              }
            },
            {
              timeout: 60_000,
              isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            },
          );
        } catch (err) {
          this.sourceIds.delete(key);
          outcome = err instanceof Unresolved ? "UNRESOLVED" : "FAILED";
          result = {
            type: "LEGACY_HISTORY",
            id: null,
            reason:
              err instanceof Unresolved
                ? err.message
                : `Import failed (${typeof err === "object" && err && "code" in err ? String(err.code) : err instanceof Error ? err.name : "validation"}); source preserved, no record values logged`,
          };
          if (mode === "import")
            await this.db.legacyRecord.upsert({
              where: {
                sourceSystem_entity_sourceId: {
                  sourceSystem: this.target.sourceSystem,
                  entity: table,
                  sourceId,
                },
              },
              create: {
                sourceSystem: this.target.sourceSystem,
                entity: table,
                sourceId,
                sourceHash,
                snapshot: json(snapshot),
                status: outcome,
                reason: result.reason,
              },
              update: { status: outcome, reason: result.reason },
            });
        }
        report.records.push({
          entity: table,
          sourceId,
          outcome,
          reason: result.reason,
          targetId: result.id ?? undefined,
        });
        report.totals[outcome] = (report.totals[outcome] ?? 0) + 1;
      }
    const [inspections, ncrs, tests, repairs, files] = await Promise.all([
      this.db.incomingInspection.count(),
      this.db.nonconformance.count(),
      this.db.injectorTest.count(),
      this.db.injectorRepairCase.count(),
      this.db.fileObject.count(),
    ]);
    report.targetCounts = {
      inspections,
      ncrs,
      injectorTests: tests,
      repairCases: repairs,
      files,
    };
    report.unresolvedMappings = await this.db.legacyRecord.count({
      where: {
        sourceSystem: this.target.sourceSystem,
        status: { in: ["UNRESOLVED", "FAILED", "CONFLICT"] },
      },
    });
    if (mode === "import" && this.enqueueScan) {
      const sourceFiles = await this.db.legacyRecord.findMany({
        where: {
          sourceSystem: this.target.sourceSystem,
          targetType: "FILE",
          targetId: { not: null },
        },
        select: { targetId: true },
      });
      const pending = await this.db.fileObject.findMany({
        where: {
          id: { in: sourceFiles.map((f) => f.targetId!) },
          status: "QUARANTINED",
        },
        select: { id: true },
      });
      report.scanEnqueueFailures = 0;
      for (const f of pending)
        try {
          await this.enqueueScan(f.id);
        } catch {
          report.scanEnqueueFailures++;
        }
      // QUARANTINED rows remain committed; the worker sweep recovers a failed post-commit enqueue.
    }
    if (mode === "validate") {
      report.sourceProfile = intake.profile;
      report.businessChecks = await reconcileBusiness(
        this.db,
        this.target.sourceSystem,
        intake,
      );
      report.attachments = [];
      const links = await this.db.legacyRecord.findMany({
        where: {
          sourceSystem: this.target.sourceSystem,
          targetType: "FILE",
          targetId: { not: null },
        },
      });
      for (const link of links) {
        const f = await this.db.fileObject.findUnique({
          where: { id: link.targetId! },
        });
        if (!f) {
          report.attachments.push({
            sourceId: link.sourceId,
            fileId: link.targetId!,
            status: "MISSING",
            bytesMatch: false,
            readable: false,
          });
          continue;
        }
        try {
          const { body } = await this.storage.getStream(f.storageKey);
          const hash = createHash("sha256");
          let size = 0;
          for await (const chunk of body) {
            hash.update(chunk);
            size += chunk.length;
          }
          const bytesMatch =
            hash.digest("hex") === f.sha256 && BigInt(size) === f.sizeBytes;
          report.attachments.push({
            sourceId: link.sourceId,
            fileId: f.id,
            status: f.status,
            bytesMatch,
            readable: bytesMatch && f.status === "CLEAN",
          });
        } catch {
          report.attachments.push({
            sourceId: link.sourceId,
            fileId: f.id,
            status: "UNREADABLE",
            bytesMatch: false,
            readable: false,
          });
        }
      }
    }
    report.durationMs = Date.now() - start;
    if (mode === "import") {
      await this.db.$transaction(async (tx) => {
        await tx.migrationRun.create({
          data: {
            datasetId: intake.datasetId,
            sourceHash: intake.sourceSha256,
            mode,
            report: json(report),
          },
        });
        await tx.auditEvent.create({
          data: {
            eventType: "migration.batch_imported",
            entityType: "SYSTEM",
            actorUserId: this.actorId,
            actorType: "USER",
            entityId: this.organizationId,
            metadata: json({
              datasetId: intake.datasetId,
              sourceHash: intake.sourceSha256,
              totals: report.totals,
            }),
            outcome: "SUCCESS",
          },
        });
      });
    }
    return report;
  }
}
