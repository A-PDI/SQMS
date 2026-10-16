import type { PrismaClient } from "@sqms/db";
import {
  hydrateInjectorRow,
  injectorScorecard,
  seedItemSerials,
} from "@sqms/legacy-domain";
import {
  digest,
  inspectionItems,
  object,
} from "../modules/operations/operations.rules";
import type { Intake, LegacyRow } from "./types";
export interface SemanticCheck {
  entity: string;
  sourceId: string;
  checks: Record<string, boolean>;
  passed: boolean;
}
/** Compares business fields after transformation. Values/hashes of credentials never enter the report. */
export async function reconcileBusiness(
  db: PrismaClient,
  sourceSystem: string,
  intake: Intake,
): Promise<SemanticCheck[]> {
  const mapped = await db.legacyRecord.findMany({ where: { sourceSystem } });
  const results: SemanticCheck[] = [];
  for (const [entity, rows] of Object.entries(intake.tables))
    for (const source of rows) {
      const link = mapped.find(
        (m) => m.entity === entity && m.sourceId === String(source.id),
      );
      const safe = { ...source };
      if (entity === "users") delete safe.password_hash;
      const checks: Record<string, boolean> = {
        sourceSnapshotPreserved:
          !!link && digest(link.snapshot) === digest(safe),
        mappingExists: !!link,
      };
      const id = link?.targetId;
      if (id && entity === "inspections") {
        const r = await db.incomingInspection.findUnique({
          where: { id },
          include: { items: { orderBy: { position: "asc" } } },
        });
        let answers: LegacyRow = {};
        try {
          answers =
            typeof source.section_data === "string"
              ? JSON.parse(source.section_data)
              : source.section_data;
        } catch {
          checks.validSourceJson = false;
        }
        const items = r
          ? seedItemSerials(
              inspectionItems(answers, r.itemCount),
              String(source.lot_serial_no ?? ""),
            )
          : [];
        Object.assign(checks, {
          originalPart: r?.originalPartNumber === (source.part_number || null),
          originalSupplier: r?.originalSupplier === (source.supplier || null),
          answersPreserved: digest(r?.sectionData) === digest(answers),
          itemCount: r?.items.length === items.length,
          perItemValuesAndSerials:
            !!r &&
            r.items.every(
              (item, index) =>
                digest(item.results) === digest(items[index]) &&
                item.serialNumber === (items[index]?.__serial_no || null),
            ),
          noInventedApproval: r?.productApprovalId === null,
        });
      } else if (id && entity === "ncrs") {
        const n = await db.nonconformance.findUnique({ where: { id } });
        Object.assign(checks, {
          originalNumber: n?.number === String(source.ncr_number),
          dispositionExceptionPreserved:
            object(n?.legacyException).originalDisposition ===
            source.ncr_disposition,
          quantityPreserved:
            n?.quantityAffected ===
            (source.quantity_affected == null
              ? null
              : Number(source.quantity_affected)),
        });
      } else if (id && entity === "injector_test_reports") {
        const r = await db.injectorTest.findUnique({ where: { id } });
        const score = injectorScorecard(hydrateInjectorRow(source));
        Object.assign(checks, {
          reportSlot:
            r?.reportExternalId === String(source.report_ext_id) &&
            r?.slotPosition === Number(source.slot_position),
          originalPart: r?.partNumber === (source.part_number || null),
          originalSerial: r?.serialNumber === (source.serial_number || null),
          outcome: r?.outcome === score.outcome,
          stepCounts:
            r?.stepsTotal === score.stepsTotal &&
            r?.stepsPassed === score.stepsPassed &&
            r?.stepsFailed === score.stepsFailed,
          measurementValuesUnitsAndSpecs:
            digest(object(r?.report).tests) ===
            digest(hydrateInjectorRow(source).tests),
        });
      } else if (id && entity === "injector_repair_cases") {
        const r = await db.injectorRepairCase.findUnique({
          where: { id },
          include: { _count: { select: { attempts: true } } },
        });
        Object.assign(checks, {
          originalSerial: r?.serialNumber === source.serial_number,
          status: r?.status === source.status,
          allAttempts:
            r?._count.attempts ===
            (intake.tables.injector_repair_attempts ?? []).filter(
              (a) => a.repair_case_id === source.id,
            ).length,
        });
      } else if (id && entity === "injector_repair_attempts") {
        const a = await db.injectorRepairAttempt.findUnique({ where: { id } });
        Object.assign(checks, {
          attemptNumber: a?.attemptNumber === Number(source.attempt_number),
          status: a?.status === source.status,
          outcome: a?.outcome === source.outcome,
          changesAndDeltas:
            digest(a?.changes) ===
              digest(
                (intake.tables.injector_repair_changes ?? []).filter(
                  (r) => r.repair_attempt_id === source.id,
                ),
              ) &&
            digest(a?.deltas) ===
              digest(
                (intake.tables.injector_repair_result_deltas ?? []).filter(
                  (r) => r.repair_attempt_id === source.id,
                ),
              ),
        });
      }
      results.push({
        entity,
        sourceId: String(source.id),
        checks,
        passed: Object.values(checks).every(Boolean),
      });
    }
  return results;
}
