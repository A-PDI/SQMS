import { Injectable } from "@nestjs/common";
import { Prisma, type InjectorTest } from "@sqms/db";
import {
  matchesStepCriteria,
  zonedDayRange,
  buildInjectorAnalyticsFromRows,
  buildInjectorAnalyticsWorkbookFromReport,
  INJECTOR_ANALYTICS_DEFINITIONS,
  buildCustomerReport,
  buildExportModel,
  buildInjectorWorkbook,
  buildReportPreview,
  buildShipmentEvaluationReport,
  calculateDelta,
  exclusionReasons,
  injectorScorecard,
  mapReportToInjector,
  measurementSnapshot,
  normaliseSerial,
  partKey,
  unitResolver,
} from "@sqms/legacy-domain";
import type { Actor } from "../../common/auth/actor";
import { AuditService } from "../../common/audit/audit.service";
import { DbService, type Tx } from "../../common/db/db.service";
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  StaleVersionError,
} from "../../common/errors/app-errors";
import {
  pageArgs,
  trimQ,
  type PageQueryDto,
} from "../../common/http/pagination";
import { OutboxService } from "../../common/services/outbox.service";
import { digest, object, type JsonObject } from "./operations.rules";
import type {
  InjectorSelectionDto,
  NewRepairDto,
  RepairAttemptDto,
  RetestDto,
  QuickRepairDto,
} from "./operations.dto";

const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const active = ["OPEN", "HOLD", "ENGINEERING_REVIEW"];
const quickMeasurements = [
  {
    key: "preload_screw_height",
    label: "Preload Screw Height",
    component: "Spring",
    units: ["mm", "in"],
  },
  {
    key: "armature_stroke",
    label: "Armature Stroke",
    component: "Armature",
    units: ["mm", "in"],
  },
  {
    key: "needle_stroke",
    label: "Needle Stroke",
    component: "Needle",
    units: ["mm", "in"],
  },
  ...["Nozzle Nut", "Valve Body", "Solenoid Nut"].map((component) => ({
    key: `${component.toLowerCase().replaceAll(" ", "_")}_torque`,
    label: `${component} Torque`,
    component: component === "Solenoid Nut" ? "Solenoid" : component,
    units: ["ft-lb", "in-lb", "N·m"],
  })),
];
const components = [
  "Nozzle",
  "Needle",
  "Control Valve",
  "Control Ball",
  "Armature",
  "Stator",
  "Solenoid",
  "Spring",
  "Nozzle Nut",
  "Valve Body",
  "Housing",
  "Other",
];
const actions = [
  "Adjusted",
  "Replaced",
  "Reworked",
  "Cleaned",
  "Retorqued",
  "Lapped",
  "Inspected",
  "No Change",
];
function repairChanges(changes: JsonObject[]) {
  if (!changes.length || changes.length > 25)
    throw new BusinessRuleError("Record 1–25 structured component changes");
  return changes.map((c) => {
    if (!components.includes(c.component) || !actions.includes(c.action_type))
      throw new BusinessRuleError(
        "Choose a supported repair component and action",
      );
    for (const [field, maximum] of [
      ["parameter", 120],
      ["before_value", 100],
      ["after_value", 100],
      ["unit", 40],
      ["notes", 500],
    ] as const)
      if (
        c[field] != null &&
        (typeof c[field] !== "string" || c[field].length > maximum)
      )
        throw new BusinessRuleError(
          `Repair ${field} must be text up to ${maximum} characters`,
        );
    return {
      component: c.component,
      action_type: c.action_type,
      parameter: c.parameter ?? null,
      before_value: c.before_value ?? null,
      after_value: c.after_value ?? null,
      unit: c.unit ?? null,
      notes: c.notes ?? null,
    };
  });
}
export function presentTest(row: InjectorTest): JsonObject {
  return {
    ...object(row.report),
    id: row.id,
    report_ext_id: row.reportExternalId,
    slot_position: row.slotPosition,
    part_number: row.partNumber,
    serial_number: row.serialNumber,
    job_number: row.jobNumber,
    test_datetime: row.testAt?.toISOString() ?? null,
    result_status: row.outcome,
    overall_pass:
      row.outcome === "pass" ? 1 : row.outcome === "fail" ? 0 : null,
    tests: object(row.report).tests ?? [],
  };
}
@Injectable()
export class InjectorService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}
  async list(
    q: PageQueryDto & {
      outcome?: string;
      partNumber?: string;
      serialNumber?: string;
      dateFrom?: string;
      dateTo?: string;
      stepCodes?: string;
      stepStatus?: string;
      stepMatch?: string;
    },
  ) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const term = trimQ(q.q);
    if (q.dateFrom && q.dateTo && q.dateFrom > q.dateTo)
      throw new BusinessRuleError("Start date must precede end date");
    const where: Prisma.InjectorTestWhereInput = {
      AND: [
        {
          OR: [
            { serialNumber: null },
            { NOT: { serialNumber: { startsWith: "R" } } },
          ],
        },
        {
          OR: [
            { jobNumber: null },
            { NOT: { jobNumber: { contains: "RMA" } } },
          ],
        },
      ],
      ...(q.dateFrom || q.dateTo
        ? {
            testAt: {
              ...(q.dateFrom
                ? {
                    gte: new Date(
                      zonedDayRange(q.dateFrom, "America/Denver").from,
                    ),
                  }
                : {}),
              ...(q.dateTo
                ? { lt: new Date(zonedDayRange(q.dateTo, "America/Denver").to) }
                : {}),
            },
          }
        : {}),
      ...(q.outcome ? { outcome: q.outcome } : {}),
      ...(q.partNumber ? { partNumber: q.partNumber } : {}),
      ...(q.serialNumber
        ? { normalizedSerial: normaliseSerial(q.serialNumber) }
        : {}),
      ...(term
        ? {
            OR: [
              { partNumber: { contains: term } },
              { serialNumber: { contains: term } },
              { reportExternalId: { contains: term } },
            ],
          }
        : {}),
    };
    if (q.serialNumber && q.partNumber) {
      const known = await this.db.client.injectorTest.findMany({
        where: { partNumber: q.partNumber },
        select: { serialNumber: true },
      });
      const resolve = unitResolver(
        known.map((r) => r.serialNumber ?? "").concat(q.serialNumber),
      );
      where.normalizedSerial = undefined;
      where.serialNumber = {
        in: known
          .map((r) => r.serialNumber)
          .filter(
            (v): v is string => !!v && resolve(v) === resolve(q.serialNumber!),
          ),
      };
    }
    const steps = (q.stepCodes ?? "").split(/[\s,;]+/).filter(Boolean);
    if (steps.length) {
      if (
        steps.length > 50 ||
        (await this.db.client.injectorTest.count({ where })) > 20000
      )
        throw new BusinessRuleError(
          "Choose up to 50 steps and narrow the part/date range to 20,000 tests for step filtering",
        );
      const rows = await this.db.client.injectorTest.findMany({
        where,
        orderBy: [
          { testAt: "desc" },
          { reportExternalId: "asc" },
          { slotPosition: "asc" },
        ],
      });
      const matching = rows.filter((r) =>
        matchesStepCriteria(presentTest(r), {
          steps,
          stepStatus: q.stepStatus ?? "fail",
          stepMatch: q.stepMatch ?? "any",
        }),
      );
      return {
        total: matching.length,
        page,
        pageSize,
        items: matching
          .slice(skip, skip + take)
          .map((r) => ({ ...r, report: undefined })),
      };
    }
    const [total, rows] = await Promise.all([
      this.db.client.injectorTest.count({ where }),
      this.db.client.injectorTest.findMany({
        where,
        skip,
        take,
        orderBy: [
          { testAt: "desc" },
          { reportExternalId: "asc" },
          { slotPosition: "asc" },
        ],
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: rows.map((r) => ({ ...r, report: undefined })),
    };
  }
  async get(id: string) {
    const r = await this.db.client.injectorTest.findUnique({ where: { id } });
    if (!r) throw new NotFoundError("Injector test");
    return r;
  }
  async quickContext(id: string) {
    const test = await this.get(id);
    const tests = await this.db.client.injectorTest.findMany({
      where: { partNumber: test.partNumber },
      select: { serialNumber: true, testAt: true, id: true },
    });
    const cases = await this.db.client.injectorRepairCase.findMany({
      where: { partNumber: test.partNumber ?? "" },
      include: { attempts: { orderBy: { attemptNumber: "asc" } } },
      orderBy: { openedAt: "desc" },
    });
    const resolve = unitResolver(
      tests
        .map((t) => t.serialNumber ?? "")
        .concat(cases.map((c) => c.serialNumber)),
    );
    const same = cases.filter(
      (c) =>
        test.serialNumber &&
        resolve(c.serialNumber) === resolve(test.serialNumber),
    );
    const repairCase = same.find((c) => active.includes(c.status));
    const previous = repairCase?.attempts.at(-1);
    let reason =
      !test.serialNumber || !test.partNumber
        ? "Part and serial are required"
        : !test.testAt
          ? "Resolve the test date before recording repair history"
          : "";
    if (repairCase && repairCase.status !== "OPEN")
      reason = "Reopen the held repair in Repair History first";
    if (test.outcome === "pass" || (!repairCase && test.outcome !== "fail"))
      reason =
        "Quick entry starts from a failed test; use Repair History to link passing retests";
    if (
      tests.some(
        (t) =>
          t.serialNumber &&
          test.serialNumber &&
          resolve(t.serialNumber) === resolve(test.serialNumber) &&
          t.testAt &&
          test.testAt &&
          t.testAt > test.testAt,
      )
    )
      reason = "Record repair against the latest test for this injector";
    if (
      previous &&
      (previous.status === "WAITING_RETEST"
        ? object(previous.beforeSnapshot).id === id
        : object(previous.afterSnapshot).id !== id)
    )
      reason = "A repair is already recorded here; select its later retest";
    return {
      testId: id,
      measurements: quickMeasurements,
      canSave: !reason,
      reason,
      caseId: repairCase?.id,
      expectedCaseVersion: repairCase?.version,
      attemptNumber: (previous?.attemptNumber ?? 0) + 1,
      linksPreviousRetest:
        previous?.status === "WAITING_RETEST" &&
        object(previous.beforeSnapshot).id !== id,
    };
  }
  async quickRepair(actor: Actor, id: string, dto: QuickRepairDto) {
    const seen = new Set();
    const changes = dto.measurements.flatMap((m) => {
      const def = quickMeasurements.find((d) => d.key === m.key);
      if (!def || seen.has(m.key))
        throw new BusinessRuleError(
          "Unknown or repeated quick-entry measurement",
        );
      seen.add(m.key);
      const before = String(m.before_value ?? "").trim(),
        after = String(m.after_value ?? "").trim();
      if (!before && !after) return [];
      if (
        ![before, after].every(
          (v) =>
            /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(v) && Number.isFinite(Number(v)),
        ) ||
        !def.units.includes(String(m.unit))
      )
        throw new BusinessRuleError(
          `${def.label}: enter nonnegative Before and After values and a valid unit`,
        );
      return [
        {
          component: def.component,
          parameter: def.label,
          action_type:
            Number(before) === Number(after) ? "No Change" : "Adjusted",
          before_value: before,
          after_value: after,
          unit: m.unit,
        },
      ];
    });
    if (!changes.length)
      throw new BusinessRuleError("Record at least one before/after pair");
    return this.db.tx(async (tx) => {
      // Lock the source test to serialize a first quick-entry case and keep the entire command atomic.
      await this.db.lockRow(tx, "injector_tests", id);
      const context = await this.quickContext(id);
      if (!context.canSave) throw new ConflictError(context.reason);
      let c = context.caseId
        ? await this.lockCase(tx, context.caseId, dto.expectedCaseVersion ?? -1)
        : await this.openRepairIn(tx, actor, {
            testId: id,
            failureCategories: [],
          });
      if (context.linksPreviousRetest) {
        const previous = await tx.injectorRepairAttempt.findFirstOrThrow({
          where: { repairCaseId: c.id },
          orderBy: { attemptNumber: "desc" },
        });
        await this.retestIn(tx, actor, previous.id, {
          expectedVersion: previous.version,
          afterTestId: id,
          observedOutcome:
            "Unsuccessful retest reviewed while recording the next repair",
        });
        c = await tx.injectorRepairCase.findUniqueOrThrow({
          where: { id: c.id },
        });
      }
      await this.addAttemptIn(tx, actor, c.id, {
        expectedVersion: c.version,
        beforeTestId: id,
        repairDate: dto.repairDate,
        diagnosis: "Measurements recorded via Quick Entry",
        notes: dto.notes,
        changes,
      });
      return { caseId: c.id };
    });
  }
  async detailedAnalytics(
    filters: {
      date_from?: string;
      date_to?: string;
      interval?: string;
      part_number?: string;
    },
    workbook = false,
  ) {
    const [tests, cases] = await Promise.all([
      this.db.client.injectorTest.findMany(),
      this.db.client.injectorRepairCase.findMany({
        include: { attempts: { orderBy: { attemptNumber: "asc" } } },
      }),
    ]);
    const data = {
      tests: tests.map(presentTest),
      cases: cases.map((c) => ({
        ...c,
        part_number: c.partNumber,
        serial_number: c.serialNumber,
        initial_test_datetime: object(c.initialTestSnapshot).test_datetime,
        closed_at: c.closedAt?.toISOString(),
      })),
      attempts: cases.flatMap((c) =>
        c.attempts.map((a) => ({
          ...a,
          repair_case_id: c.id,
          attempt_number: a.attemptNumber,
          repair_date: a.repairDate.toISOString(),
        })),
      ),
      changes: cases.flatMap((c) =>
        c.attempts.flatMap((a) =>
          (a.changes as JsonObject[]).map((x) => ({
            ...x,
            repair_attempt_id: a.id,
          })),
        ),
      ),
      deltas: cases.flatMap((c) =>
        c.attempts.flatMap((a) =>
          (a.deltas as JsonObject[]).map((d) => ({
            ...d,
            repair_attempt_id: a.id,
            step_key: d.key ?? d.step_key,
            before_value: d.before?.value ?? d.before_value,
            after_value: d.after?.value ?? d.after_value,
            before_status: d.before?.status ?? d.before_status,
            after_status: d.after?.status ?? d.after_status,
            measurement_unit: d.before?.unit ?? d.measurement_unit,
          })),
        ),
      ),
      lastSync: tests
        .reduce((v, t) => (t.syncedAt > v ? t.syncedAt : v), new Date(0))
        .toISOString(),
    };
    let report: JsonObject;
    try {
      report = buildInjectorAnalyticsFromRows(data, filters, workbook);
    } catch {
      throw new BusinessRuleError(
        "Choose valid analytics dates, part and grouping",
      );
    }
    return workbook
      ? buildInjectorAnalyticsWorkbookFromReport(report)
      : { ...report, definitions: INJECTOR_ANALYTICS_DEFINITIONS };
  }
  async syncRecorded(actor: Actor, rawReports: JsonObject[]) {
    const result = {
      imported: 0,
      updated: 0,
      unchanged: 0,
      linkedRetests: 0,
      excluded: [] as { index: number; reasons: string[] }[],
    };
    const rows = new Map<string, { mapped: JsonObject; hash: string }>();
    for (let i = 0; i < rawReports.length; i++) {
      const reasons = exclusionReasons(rawReports[i]);
      if (reasons.length) {
        result.excluded.push({ index: i, reasons });
        continue;
      }
      const m = mapReportToInjector(rawReports[i]);
      if (
        !m.report_ext_id ||
        m.report_ext_id.length > 200 ||
        !Number.isInteger(m.slot_position) ||
        m.slot_position < 0
      )
        throw new BusinessRuleError(
          `Report ${i + 1} has no valid report/slot identity`,
        );
      const key = `${m.report_ext_id}:${m.slot_position}`;
      const hash = digest(m);
      if (rows.has(key) && rows.get(key)!.hash !== hash)
        throw new BusinessRuleError(
          "Conflicting reports for the same report/slot identity; reconcile the source recording",
        );
      rows.set(key, { mapped: m, hash });
    }
    // One transaction: import, audit and durable event either all commit or all roll back.
    await this.db.tx(async (tx) => {
      for (const { mapped: m, hash } of rows.values()) {
        const identity = {
          reportExternalId: m.report_ext_id,
          slotPosition: m.slot_position,
        };
        const existing = await tx.injectorTest.findUnique({
          where: { reportExternalId_slotPosition: identity },
        });
        if (existing?.sourceHash === hash) {
          result.unchanged++;
          continue;
        }
        const testAt = m.test_datetime ? new Date(m.test_datetime) : null;
        if (testAt && !Number.isFinite(testAt.getTime()))
          throw new BusinessRuleError(
            "Test date must be parseable; preserve ambiguous legacy dates through migration reconciliation",
          );
        const score = injectorScorecard(m);
        const data = {
          ...identity,
          jobNumber:
            m.job_number == null ? null : String(m.job_number).slice(0, 200),
          partNumber: m.part_number == null ? null : String(m.part_number),
          serialNumber:
            m.serial_number == null ? null : String(m.serial_number),
          normalizedSerial:
            m.serial_number == null
              ? null
              : normaliseSerial(String(m.serial_number)),
          testAt,
          outcome: score.outcome,
          stepsTotal: score.stepsTotal,
          stepsPassed: score.stepsPassed,
          stepsFailed: score.stepsFailed,
          report: json({
            ...m.report_json,
            tests: m.tests,
            brand: m.brand,
            injector_type: m.injector_type,
            machine_name: m.machine_name,
            machine_sn: m.machine_sn,
          }),
          sourceHash: hash,
          syncedAt: new Date(),
        };
        await tx.injectorTest.upsert({
          where: { reportExternalId_slotPosition: identity },
          create: data,
          update: { ...data, version: { increment: 1 } },
        });
        if (existing) result.updated++;
        else result.imported++;
      }
      result.linkedRetests = await this.autoLinkRetests(tx, actor, [
        ...new Set(
          [...rows.values()].map((r) => String(r.mapped.part_number ?? "")),
        ),
      ]);
      await this.audit.record(
        {
          eventType: "injector.recording_imported",
          entityType: "SYSTEM",
          metadata: {
            mode: "recorded",
            ...result,
            excluded: result.excluded.length,
          },
        },
        tx,
      );
      await this.outbox.publish(
        tx,
        "injector.recording_imported",
        "SYSTEM",
        actor.organizationId,
        {
          imported: result.imported,
          updated: result.updated,
          excluded: result.excluded.length,
        },
      );
    });
    return result;
  }
  private async autoLinkRetests(tx: Tx, actor: Actor, parts: string[]) {
    let linked = 0;
    const cases = await tx.injectorRepairCase.findMany({
      where: {
        partNumber: { in: parts },
        status: "OPEN",
        attempts: { some: { status: "WAITING_RETEST" } },
      },
      include: {
        attempts: {
          where: { status: "WAITING_RETEST" },
          orderBy: { attemptNumber: "desc" },
        },
      },
    });
    for (const c of cases) {
      const attempt = c.attempts[0];
      const before = new Date(
        object(attempt.beforeSnapshot).test_datetime ?? "",
      );
      if (!Number.isFinite(before.getTime())) continue;
      const known = await tx.injectorTest.findMany({
        where: { partNumber: c.partNumber },
      });
      const resolve = unitResolver(
        known.map((t) => t.serialNumber ?? "").concat(c.serialNumber),
      );
      const candidates = known
        .filter(
          (t) =>
            t.serialNumber &&
            !/^R/i.test(t.serialNumber) &&
            !/RMA/i.test(t.jobNumber ?? "") &&
            resolve(t.serialNumber) === resolve(c.serialNumber) &&
            t.testAt &&
            t.testAt > before &&
            t.testAt >= attempt.repairDate,
        )
        .sort(
          (a, b) =>
            a.testAt!.getTime() - b.testAt!.getTime() ||
            a.reportExternalId.localeCompare(b.reportExternalId) ||
            a.slotPosition - b.slotPosition,
        );
      if (
        !candidates.length ||
        (candidates.length > 1 &&
          candidates[0].testAt!.getTime() === candidates[1].testAt!.getTime())
      )
        continue;
      try {
        await this.retestIn(tx, actor, attempt.id, {
          expectedVersion: attempt.version,
          afterTestId: candidates[0].id,
          observedOutcome:
            "Automatically linked the earliest unambiguous recorded retest after the repair; no material release authorized",
        });
        linked++;
      } catch (error) {
        // An operator may have reviewed/held it while sync staged reports. DB/transport failures still roll back.
        if (
          !(
            error instanceof StaleVersionError ||
            error instanceof ConflictError ||
            error instanceof BusinessRuleError
          )
        )
          throw error;
      }
    }
    return linked;
  }
  async selected(ids: string[]) {
    if (!ids.length || new Set(ids).size !== ids.length)
      throw new BusinessRuleError(
        "Choose a nonempty selection without duplicate test IDs",
      );
    const rows = await this.db.client.injectorTest.findMany({
      where: { id: { in: ids } },
    });
    if (rows.length !== ids.length)
      throw new NotFoundError("Selected injector test");
    return ids.map((id) => presentTest(rows.find((r) => r.id === id)!));
  }
  async preview(ids: string[]) {
    return buildReportPreview(await this.selected(ids));
  }
  async report(actor: Actor, dto: InjectorSelectionDto) {
    const rows = await this.selected(dto.ids);
    await this.audit.record({
      eventType: "injector.report_exported",
      entityType: "SYSTEM",
      metadata: { format: dto.format ?? "customer", ids: dto.ids },
    });
    if (dto.format === "xlsx") {
      const book = await buildInjectorWorkbook(
        buildExportModel(rows, { vendorName: dto.vendorName }),
      );
      return {
        buffer: Buffer.from(await book.xlsx.writeBuffer()),
        filename: "InjectorTests.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
    }
    const r =
      dto.format === "supplier_evaluation"
        ? await buildShipmentEvaluationReport(rows, {
            vendorName: dto.vendorName,
          })
        : await buildCustomerReport(rows, { vendorName: dto.vendorName });
    return { ...r, contentType: "application/pdf" };
  }
  async analytics() {
    const rows = await this.db.client.injectorTest.findMany({
      select: {
        id: true,
        partNumber: true,
        serialNumber: true,
        normalizedSerial: true,
        testAt: true,
        outcome: true,
      },
    });
    const resolvers = new Map<string, ReturnType<typeof unitResolver>>();
    for (const part of new Set(rows.map((r) => partKey(r.partNumber ?? ""))))
      resolvers.set(
        part,
        unitResolver(
          rows
            .filter((r) => partKey(r.partNumber ?? "") === part)
            .map((r) => r.serialNumber ?? ""),
        ),
      );
    const units = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!r.serialNumber || !r.testAt) continue;
      const part = partKey(r.partNumber ?? "");
      const key = `${part}:${r.serialNumber ? resolvers.get(part)!(r.serialNumber) : r.id}`;
      const history = units.get(key) ?? [];
      history.push(r);
      units.set(key, history);
    }
    let passedFirst = 0,
      passedLatest = 0;
    for (const h of units.values()) {
      h.sort((a, b) => (a.testAt?.getTime() ?? 0) - (b.testAt?.getTime() ?? 0));
      if (h[0].outcome === "pass") passedFirst++;
      if (h.at(-1)!.outcome === "pass") passedLatest++;
    }
    return {
      testCount: rows.length,
      unidentifiedTests: rows.filter((r) => !r.serialNumber).length,
      undatedTests: rows.filter((r) => !r.testAt).length,
      physicalUnits: units.size,
      passedFirst,
      passedLatest,
      outcomes: Object.fromEntries(
        ["pass", "fail", "dnf", "unknown"].map((o) => [
          o,
          rows.filter((r) => r.outcome === o).length,
        ]),
      ),
      definitions: {
        firstPass:
          "First observed test per part and unambiguous serial identity; DNF/unknown are retained in the denominator",
        latestPass:
          "Latest observed test per unit; observed history may predate this dataset",
      },
    };
  }
  async repairs(q: PageQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const term = trimQ(q.q);
    const where: Prisma.InjectorRepairCaseWhereInput = term
      ? {
          OR: [
            { partNumber: { contains: term } },
            { serialNumber: { contains: term } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.db.client.injectorRepairCase.findMany({
        where,
        skip,
        take,
        orderBy: [{ openedAt: "desc" }, { id: "asc" }],
        select: {
          id: true,
          partNumber: true,
          serialNumber: true,
          status: true,
          openedAt: true,
          closedAt: true,
          version: true,
          _count: { select: { attempts: true } },
        },
      }),
      this.db.client.injectorRepairCase.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
  async repair(id: string) {
    const r = await this.db.client.injectorRepairCase.findUnique({
      where: { id },
      include: { attempts: { orderBy: { attemptNumber: "asc" } } },
    });
    if (!r) throw new NotFoundError("Repair case");
    return r;
  }
  private async testIn(tx: Tx, id: string) {
    const r = await tx.injectorTest.findUnique({ where: { id } });
    if (!r) throw new NotFoundError("Injector test");
    return r;
  }
  private async sameUnit(
    tx: Tx,
    left: { partNumber: string; serialNumber: string },
    right: InjectorTest,
  ) {
    if (
      partKey(left.partNumber) !== partKey(right.partNumber ?? "") ||
      !right.serialNumber
    )
      throw new BusinessRuleError(
        "Retest must belong to the same part and physical injector",
      );
    const known = await tx.injectorTest.findMany({
      where: { partNumber: right.partNumber },
      select: { serialNumber: true },
    });
    const resolve = unitResolver(
      known.map((r) => r.serialNumber ?? "").concat(left.serialNumber),
    );
    if (resolve(left.serialNumber) !== resolve(right.serialNumber))
      throw new BusinessRuleError("Serial identity is different or ambiguous");
  }
  async openRepair(actor: Actor, dto: NewRepairDto) {
    return this.db.tx((tx) => this.openRepairIn(tx, actor, dto));
  }
  private async openRepairIn(tx: Tx, actor: Actor, dto: NewRepairDto) {
    const test = await this.testIn(tx, dto.testId);
    if (!test.partNumber || !test.serialNumber)
      throw new BusinessRuleError(
        "Repair tracking requires a part number and serial identity",
      );
    if (!test.testAt)
      throw new BusinessRuleError(
        "Resolve the failed test timestamp before opening repair history",
      );
    if (test.outcome !== "fail")
      throw new BusinessRuleError(
        "Start a repair episode from a demonstrated failed test; DNF alone is not an injector failure",
      );
    const known = await tx.injectorTest.findMany({
      where: { partNumber: test.partNumber },
      select: { serialNumber: true },
    });
    const normalized = unitResolver(known.map((r) => r.serialNumber ?? ""))(
      test.serialNumber,
    );
    const key = digest([partKey(test.partNumber), normalized]);
    const resolve = unitResolver(
      known.map((r) => r.serialNumber ?? "").concat(test.serialNumber),
    );
    const history = (
      await tx.injectorRepairCase.findMany({
        where: { partNumber: test.partNumber },
      })
    ).filter((c) => resolve(c.serialNumber) === resolve(test.serialNumber!));
    const previous = history.find((c) => active.includes(c.status));
    if (previous)
      throw new ConflictError(
        "An active repair case already exists for this physical injector",
      );
    if (
      history.some(
        (c) =>
          new Date(
            object(c.finalTestSnapshot).test_datetime ??
              object(c.initialTestSnapshot).test_datetime ??
              "",
          ).getTime() >= test.testAt!.getTime(),
      )
    )
      throw new ConflictError(
        "Start a new episode from a failure later than the existing repair history",
      );
    const r = await tx.injectorRepairCase.create({
      data: {
        partNumber: test.partNumber,
        serialNumber: test.serialNumber,
        normalizedSerial: normalized,
        activeKey: key,
        initialTestSnapshot: json(presentTest(test)),
        failureCategories: json(dto.failureCategories),
        openedById: actor.userId,
      },
    });
    await this.audit.record(
      {
        eventType: "repair.opened",
        entityType: "INJECTOR_REPAIR",
        entityId: r.id,
        metadata: { testId: test.id },
      },
      tx,
    );
    return r;
  }
  private async lockCase(tx: Tx, id: string, version: number) {
    await this.db.lockRow(tx, "injector_repair_cases", id);
    const r = await tx.injectorRepairCase.findUnique({
      where: { id },
      include: { attempts: { orderBy: { attemptNumber: "asc" } } },
    });
    if (!r) throw new NotFoundError("Repair case");
    if (r.version !== version) throw new StaleVersionError("Repair case");
    return r;
  }
  async addAttempt(actor: Actor, id: string, dto: RepairAttemptDto) {
    return this.db.tx((tx) => this.addAttemptIn(tx, actor, id, dto));
  }
  private async addAttemptIn(
    tx: Tx,
    actor: Actor,
    id: string,
    dto: RepairAttemptDto,
  ) {
    const c = await this.lockCase(tx, id, dto.expectedVersion);
    if (c.status !== "OPEN")
      throw new BusinessRuleError(
        "Reopen held or reviewed repair cases before adding an attempt",
      );
    const test = await this.testIn(tx, dto.beforeTestId);
    await this.sameUnit(tx, c, test);
    if (!test.testAt)
      throw new BusinessRuleError(
        "Resolve the before-test timestamp before recording this attempt",
      );
    if (test.outcome === "pass")
      throw new BusinessRuleError(
        "A passing test cannot be the baseline of a failure-repair attempt",
      );
    const changes = repairChanges(dto.changes);
    if (c.attempts.some((a) => a.status === "WAITING_RETEST"))
      throw new BusinessRuleError(
        "Link the pending retest before adding another attempt",
      );
    const repairDate = new Date(dto.repairDate);
    // A date-only shop entry means the end of that day for this ordering check; retain the supplied date separately.
    if (
      test.testAt &&
      test.testAt.getTime() >= repairDate.getTime() + 86_400_000
    )
      throw new BusinessRuleError("Repair date precedes the before-test");
    const last = c.attempts.at(-1);
    const baseline = object(last?.afterSnapshot ?? c.initialTestSnapshot);
    if (
      baseline.id !== test.id &&
      !(
        baseline.report_ext_id === test.reportExternalId &&
        baseline.slot_position === test.slotPosition
      )
    )
      throw new BusinessRuleError(
        "An attempt must start from the initial failure or previous linked retest",
      );
    const r = await tx.injectorRepairAttempt.create({
      data: {
        repairCaseId: id,
        attemptNumber: c.attempts.length + 1,
        beforeSnapshot: json(presentTest(test)),
        repairDate,
        technicianId: actor.userId,
        technician: actor.displayName,
        diagnosis: dto.diagnosis,
        hypothesis: dto.hypothesis,
        expectedOutcome: dto.expectedOutcome,
        notes: dto.notes,
        changes: json(changes),
      },
    });
    await tx.injectorRepairCase.update({
      where: { id },
      data: { version: { increment: 1 } },
    });
    await this.audit.record(
      {
        eventType: "repair.attempt_recorded",
        entityType: "INJECTOR_REPAIR",
        entityId: id,
        metadata: { attemptId: r.id, attemptNumber: r.attemptNumber },
      },
      tx,
    );
    return r;
  }
  async retest(actor: Actor, attemptId: string, dto: RetestDto) {
    return this.db.tx((tx) => this.retestIn(tx, actor, attemptId, dto));
  }
  private async retestIn(
    tx: Tx,
    actor: Actor,
    attemptId: string,
    dto: RetestDto,
  ) {
    let attempt = await tx.injectorRepairAttempt.findUnique({
      where: { id: attemptId },
      include: { repairCase: true },
    });
    if (!attempt) throw new NotFoundError("Repair attempt");
    await this.db.lockRow(tx, "injector_repair_cases", attempt.repairCaseId);
    await this.db.lockRow(tx, "injector_repair_attempts", attemptId);
    attempt = await tx.injectorRepairAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { repairCase: true },
    });
    const repairCase = await tx.injectorRepairCase.findUniqueOrThrow({
      where: { id: attempt.repairCaseId },
    });
    if (repairCase.status !== "OPEN")
      throw new BusinessRuleError(
        "Reopen this repair case before linking a retest",
      );
    if (attempt.version !== dto.expectedVersion)
      throw new StaleVersionError("Repair attempt");
    if (attempt.status !== "WAITING_RETEST")
      throw new ConflictError("This attempt already has a retest");
    const test = await this.testIn(tx, dto.afterTestId);
    await this.sameUnit(tx, repairCase, test);
    const before = object(attempt.beforeSnapshot);
    const beforeDate = new Date(before.test_datetime ?? "");
    if (!Number.isFinite(beforeDate.getTime()))
      throw new BusinessRuleError(
        "Resolve the historical before-test timestamp before comparing a retest",
      );
    if (
      !test.testAt ||
      test.testAt <= beforeDate ||
      test.testAt < attempt.repairDate
    )
      throw new BusinessRuleError(
        "Retest must follow both the before-test and repair date",
      );
    const after = presentTest(test);
    const beforeMeasurements = measurementSnapshot(before);
    const afterMeasurements = measurementSnapshot(after);
    const deltas = Array.from(
      new Set([...beforeMeasurements.keys(), ...afterMeasurements.keys()]),
    ).map((key) => {
      const b = beforeMeasurements.get(key);
      const a = afterMeasurements.get(key);
      const compatible =
        !!b &&
        !!a &&
        b.unit === a.unit &&
        b.specMin === a.specMin &&
        b.specMax === a.specMax;
      return {
        key,
        before: b ?? null,
        after: a ?? null,
        compatible,
        ...(compatible
          ? calculateDelta({ before_value: b.value, target_value: b.target }, a)
          : {
              comparisonReason:
                "Units, specification or measurement identity changed; no numerical effectiveness claim",
            }),
      };
    });
    const r = await tx.injectorRepairAttempt.update({
      where: { id: attemptId },
      data: {
        afterSnapshot: json(after),
        observedOutcome: dto.observedOutcome,
        deltas: json(deltas),
        status: "COMPLETED",
        outcome: test.outcome.toUpperCase(),
        version: { increment: 1 },
      },
    });
    await tx.injectorRepairCase.update({
      where: { id: attempt.repairCaseId },
      data: {
        ...(test.outcome === "pass"
          ? {
              status: "PASSED",
              activeKey: null,
              closedById: actor.userId,
              closedAt: new Date(),
              finalTestSnapshot: json(after),
            }
          : {}),
        version: { increment: 1 },
      },
    });
    await this.audit.record(
      {
        eventType: "repair.retest_linked",
        entityType: "INJECTOR_REPAIR",
        entityId: attempt.repairCaseId,
        metadata: { attemptId, testId: test.id, outcome: test.outcome },
      },
      tx,
    );
    await this.outbox.publish(
      tx,
      "repair.retest_linked",
      "INJECTOR_REPAIR",
      attempt.repairCaseId,
      { attemptId, outcome: test.outcome },
    );
    return r;
  }
  async setStatus(
    actor: Actor,
    id: string,
    version: number,
    status: string,
    reason: string,
  ) {
    if (reason.trim().length < 5)
      throw new BusinessRuleError("Record a meaningful status-change reason");
    return this.db.tx(async (tx) => {
      const c = await this.lockCase(tx, id, version);
      if (c.status === "PASSED")
        throw new BusinessRuleError(
          "Passed repair history is permanent; open a new case for a later failure",
        );
      const r = await tx.injectorRepairCase.update({
        where: { id },
        data: {
          status,
          activeKey: active.includes(status)
            ? digest([partKey(c.partNumber), c.normalizedSerial])
            : null,
          closedAt: status === "SCRAPPED" ? new Date() : null,
          closedById: status === "SCRAPPED" ? actor.userId : null,
          version: { increment: 1 },
        },
      });
      await this.audit.record(
        {
          eventType: "repair.status_changed",
          entityType: "INJECTOR_REPAIR",
          entityId: id,
          reason,
          changes: { status: { before: c.status, after: status } },
        },
        tx,
      );
      return r;
    });
  }
}
