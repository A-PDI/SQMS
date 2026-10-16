import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ObjectStorage } from "@sqms/server-core";
import { mapReportToInjector } from "@sqms/legacy-domain";
import { LegacyMigration } from "../src/migration/legacy-migration";
import type {
  DisposableTarget,
  Intake,
  MigrationMappings,
} from "../src/migration/types";
import {
  startApp,
  createUser,
  uniq,
  waitFor,
  type TestContext,
} from "./helpers";
import { QueueRegistry } from "@sqms/server-core";
import { QUEUES, STORAGE } from "../src/infra/tokens";
const { benchReport } = createRequire(
  path.resolve(__dirname, "../../..", "packages/legacy-domain/index.js"),
)("./test/helpers/benchData");

describe("Synthetic migration coverage for operational histories absent from the repository seed", () => {
  let ctx: TestContext,
    storage: ObjectStorage,
    root: string,
    base: Intake,
    actor: { id: string },
    orgId: string;
  const target: DisposableTarget = {
    purpose: "disposable-qms-migration",
    datasetId: "synthetic-rich-fixture",
    sourceSystem: "PDI_QMS_RICH",
    databaseHost: "127.0.0.1",
    databaseName: "sqms_unified_acceptance_test",
    storageEndpoint: "http://127.0.0.1:9000",
    redisHost: "127.0.0.1",
    redisDatabase: 1,
    storageBucket: "sqms-test-files",
  };
  beforeAll(async () => {
    ctx = await startApp({
      SUPPLIER_PORTAL_ENABLED: "false",
      MAIL_TRANSPORT: "disabled",
    });
    storage = ctx.app.get(STORAGE);
    actor = await createUser(ctx.prisma, { roles: ["SYSTEM_ADMIN"] });
    orgId = (
      await ctx.prisma.organization.findUniqueOrThrow({
        where: { code: "INTERNAL" },
      })
    ).id;
    root = mkdtempSync(path.join(tmpdir(), "sqms-rich-fixture-"));
    execFileSync(
      "python3",
      [
        path.resolve(
          __dirname,
          "../../../tools/migration/synthetic-fixture.py",
        ),
        "--output-root",
        path.join(root, "fixture"),
      ],
      { stdio: "pipe" },
    );
    base = JSON.parse(
      readFileSync(path.join(root, "fixture/intake.json"), "utf8"),
    );
  });
  afterAll(async () => {
    if (ctx) await ctx.close();
    if (root) rmSync(root, { recursive: true, force: true });
  });
  it("preserves closed NCRs, per-row photos, drawings, saved reports and complete repair snapshots on repeat imports", async () => {
    const raw = [
      benchReport({
        id: uniq("legacy-before-"),
        part: "00001-A.02",
        serial: "260521611A",
        datetime: "2026-06-29T16:00:00Z",
        flow: { IVM01: 250 },
      }),
      benchReport({
        id: uniq("legacy-after-"),
        part: "00001-A.02",
        serial: "611",
        datetime: "2026-06-30T16:00:00Z",
      }),
    ];
    const tests = raw.map((r: any, index: number) => {
      const m = mapReportToInjector(r);
      return {
        ...m,
        id: `rich-test-${index}`,
        report_json: JSON.stringify(m.report_json),
      };
    });
    const copiedFile = base.files.find((f) => f.status === "READY")!;
    const tables: Intake["tables"] = {
      users: [
        {
          id: "rich-user",
          email: `${uniq()}@fixture.local`,
          name: "Historical operator",
          role: "admin",
          active: 1,
          created_at: "2026-06-01T10:00:00Z",
        },
      ],
      inspection_templates: [
        {
          id: "rich-plan",
          form_no: "SYNTHETIC-CUSTOM",
          title: "Synthetic visual plan",
          sections: JSON.stringify({
            visual: {
              title: "Visual",
              section_type: "pass_fail_checklist",
              items: [{ id: 8, name: "Surface" }],
            },
          }),
          header_schema: "[]",
        },
      ],
      inspections: [
        {
          id: "rich-inspection",
          template_id: "rich-plan",
          part_number: "00001-A.02",
          supplier: "Original free-text supplier",
          po_number: "PO-RICH",
          created_by: "rich-user",
          assigned_to: "rich-user",
          status: "complete",
          disposition: "FAIL",
          created_at: "2026-06-29T16:00:00Z",
          section_data: JSON.stringify({
            __items: [
              { __serial_no: "S1", __disposition: "PASS" },
              {
                __serial_no: "S2",
                __disposition: "FAIL",
                __disposition_notes: "Surface gouge",
                visual: [{ id: 8, result: "F", notes: "Surface gouge" }],
              },
            ],
          }),
        },
      ],
      ncrs: [
        {
          id: "rich-ncr",
          inspection_id: "rich-inspection",
          ncr_number: uniq("NCR-OLD-"),
          part_number: "00001-A.02",
          supplier: "Original free-text supplier",
          po_number: "PO-RICH",
          created_by: "rich-user",
          created_at: "2026-06-29T16:00:00Z",
          closed_at: "2026-06-30T18:00:00Z",
          status: "closed",
          severity: "minor",
          ncr_disposition: "accepted_as_is",
          description_of_defect: "Historical surface condition",
          quantity_affected: null,
        },
      ],
      ncr_sections: [
        {
          id: "rich-section",
          ncr_id: "rich-ncr",
          title: "Finding",
          body: "Original narrative",
          sort_order: 0,
        },
      ],
      ncr_images: [
        {
          id: "rich-photo",
          ncr_id: "rich-ncr",
          section_id: "rich-section",
          file_name: "finding.png",
          caption: "Original caption",
        },
      ],
      inspection_attachments: [
        {
          id: "rich-item-photo",
          inspection_id: "rich-inspection",
          file_name: "item.png",
          section_key: "item1__visual",
          item_id: "8",
        },
      ],
      engineering_drawings: [
        {
          id: "rich-drawing",
          part_number: "00001-A.02",
          file_name: "drawing-v3.png",
          version: 3,
          is_current: 1,
        },
      ],
      quality_alerts: [
        {
          id: "rich-orphan-alert",
          inspection_id: null,
          part_number: "00001-A.02",
          supplier: "Original free-text supplier",
          alert_type: "accepted_disposition",
          notes: "Originating inspection absent from copied history",
          triggered_by: "rich-user",
          created_at: "2026-06-29T16:00:00Z",
        },
      ],
      saved_reports: [
        {
          id: "rich-report",
          name: "Historical report",
          created_by: "rich-user",
          config_json: JSON.stringify(
            JSON.stringify({
              template_id: "rich-plan",
              status: "Complete",
              disposition: "All",
              group_by: "component_type",
            }),
          ),
        },
      ],
      injector_test_reports: tests,
      injector_repair_cases: [
        {
          id: "rich-case",
          part_number: "00001-A.02",
          serial_number: "260521611A",
          initial_test_id: tests[0].id,
          initial_report_ext_id: tests[0].report_ext_id,
          initial_slot_position: 0,
          initial_test_datetime: tests[0].test_datetime,
          initial_result_status: "FAIL",
          final_test_id: tests[1].id,
          final_report_ext_id: tests[1].report_ext_id,
          final_slot_position: 0,
          final_test_datetime: tests[1].test_datetime,
          final_result_status: "PASS",
          status: "PASSED",
          failure_categories_json: '["Flow"]',
          opened_by: "rich-user",
          opened_at: "2026-06-29T17:00:00Z",
          closed_by: "rich-user",
          closed_at: "2026-06-30T17:00:00Z",
        },
      ],
      injector_repair_attempts: [
        {
          id: "rich-attempt",
          repair_case_id: "rich-case",
          attempt_number: 1,
          before_test_id: tests[0].id,
          before_report_ext_id: tests[0].report_ext_id,
          before_slot_position: 0,
          before_test_datetime: tests[0].test_datetime,
          before_result_status: "FAIL",
          after_test_id: tests[1].id,
          after_report_ext_id: tests[1].report_ext_id,
          after_slot_position: 0,
          after_test_datetime: tests[1].test_datetime,
          after_result_status: "PASS",
          repair_date: "2026-06-29",
          technician: "Historical operator",
          technician_id: "rich-user",
          diagnosis: "Needle adjustment",
          status: "COMPLETED",
          outcome: "PASS",
        },
      ],
      injector_repair_changes: [
        {
          id: "rich-change",
          repair_attempt_id: "rich-attempt",
          component: "Needle",
          action_type: "Adjusted",
          parameter: "Stroke",
          before_value: ".10",
          after_value: ".12",
          unit: "mm",
          sequence: 0,
        },
      ],
      injector_repair_result_deltas: [
        {
          id: "rich-delta",
          repair_attempt_id: "rich-attempt",
          step_key: "IVM01|1",
          before_value: 250,
          after_value: 230,
          unit: "mm3/STRK",
          before_status: "FAIL",
          after_status: "PASS",
          absolute_delta: -20,
          effectiveness: 100,
        },
      ],
    };
    const intake: Intake = {
      ...base,
      datasetId: target.datasetId,
      tables,
      files: [
        { ...copiedFile, entity: "ncr_images", sourceId: "rich-photo" },
        {
          ...copiedFile,
          entity: "inspection_attachments",
          sourceId: "rich-item-photo",
        },
        {
          ...copiedFile,
          entity: "engineering_drawings",
          sourceId: "rich-drawing",
        },
      ],
    };
    const documentType = await ctx.prisma.documentType.findUniqueOrThrow({
      where: { code: "ENG-01" },
    });
    const mappings: MigrationMappings = {
      roles: {
        admin: {
          roleKeys: ["SYSTEM_ADMIN"],
          reviewedById: actor.id,
          reason: "Synthetic fixture role review",
        },
      },
      drawingDocumentTypeId: {
        targetId: documentType.id,
        reviewedById: actor.id,
        reason: "Synthetic drawing classification fixture only",
      },
    };
    const importer = new LegacyMigration(
      ctx.prisma,
      storage,
      target,
      mappings,
      actor.id,
      orgId,
      path.join(root, "fixture/uploads"),
      (id) => ctx.app.get<QueueRegistry>(QUEUES).enqueueFileScan(id),
    );
    const first = await importer.run(intake, "import");
    expect(first.records.filter((r) => r.outcome === "FAILED")).toEqual([]);
    const repeat = await importer.run(intake, "import");
    expect(repeat.totals.CONFLICT ?? 0).toBe(0);
    expect(repeat.totals.UNCHANGED).toBe(
      Object.values(tables).reduce((n, r) => n + r.length, 0),
    );
    const links = await ctx.prisma.legacyRecord.findMany({
      where: { sourceSystem: target.sourceSystem },
    });
    const id = (entity: string) =>
      links.find((l) => l.entity === entity)!.targetId!;
    const ncr = await ctx.prisma.nonconformance.findUniqueOrThrow({
      where: { id: id("ncrs") },
    });
    expect(ncr).toMatchObject({
      status: "CLOSED",
      supplierId: null,
      quantityAffected: null,
      disposition: "USE_AS_IS_CONCESSION",
    });
    expect(ncr.legacyException).toMatchObject({
      originalSupplier: "Original free-text supplier",
      missingHistoricalApprovals: true,
    });
    const attachment = await ctx.prisma.recordAttachment.findFirstOrThrow({
      where: { entityType: "INCOMING_INSPECTION", entityId: id("inspections") },
    });
    expect(attachment.context).toMatchObject({
      itemPosition: 1,
      sectionKey: "visual",
      rowId: "8",
    });
    expect(
      await ctx.prisma.operationalAlert.findUniqueOrThrow({
        where: { id: id("quality_alerts") },
      }),
    ).toMatchObject({
      inspectionId: null,
      originalPartNumber: "00001-A.02",
      acknowledgedAt: null,
    });
    const repair = await ctx.prisma.injectorRepairCase.findUniqueOrThrow({
      where: { id: id("injector_repair_cases") },
      include: { attempts: true },
    });
    expect(repair.status).toBe("PASSED");
    expect(repair.attempts[0].beforeSnapshot).toMatchObject({
      id: links.find(
        (l) =>
          l.entity === "injector_test_reports" && l.sourceId === tests[0].id,
      )!.targetId,
    });
    expect(
      (repair.attempts[0].beforeSnapshot as any).tests.length,
    ).toBeGreaterThan(0);
    const drawing = await ctx.prisma.documentRecord.findFirstOrThrow({
      where: {
        links: { some: { entityId: ncr.internalPartId!, linkRole: "DRAWING" } },
      },
      include: { revisions: true },
    });
    expect(drawing.status).toBe("DRAFT");
    expect(drawing.revisions[0].changeSummary).toContain("Original version: 3");
    expect(
      (
        await ctx.prisma.savedView.findUniqueOrThrow({
          where: { id: id("saved_reports") },
        })
      ).filters,
    ).toMatchObject({
      status: "COMPLETE",
      groupBy: "component",
      disposition: "",
    });
    await waitFor(
      async () =>
        (await ctx.prisma.fileObject.count({
          where: {
            id: {
              in: links
                .filter((l) => l.targetType === "FILE")
                .map((l) => l.targetId!),
            },
            status: "CLEAN",
          },
        })) === 3,
      60000,
    );
    const validated = await importer.run(intake, "validate");
    expect(validated.businessChecks?.filter((c) => !c.passed)).toEqual([]);
    expect(validated.attachments?.every((f) => f.readable)).toBe(true);
  });
  it("requires an explicit override for an ambiguous historical daylight-saving timestamp", async () => {
    const intake: Intake = {
      ...base,
      datasetId: "synthetic-dst-fixture",
      sourceTimezone: "America/Denver",
      files: [],
      tables: {
        ncrs: [
          {
            id: "dst-ncr",
            ncr_number: uniq("DST-"),
            created_at: "2026-11-01 01:30:00",
            severity: "minor",
            status: "open",
            description_of_defect: "Synthetic timestamp finding",
          },
        ],
      },
    };
    const t = {
      ...target,
      datasetId: intake.datasetId,
      sourceSystem: "PDI_QMS_DST",
    };
    const missing = new LegacyMigration(
      ctx.prisma,
      storage,
      t,
      { roles: {} },
      actor.id,
      orgId,
    );
    expect((await missing.run(intake, "dry-run")).records[0].reason).toMatch(
      /daylight-saving/,
    );
    const reviewed = new LegacyMigration(
      ctx.prisma,
      storage,
      t,
      {
        roles: {},
        timestampOverrides: {
          "ncrs:dst-ncr:created_at": "2026-11-01T07:30:00Z",
        },
      },
      actor.id,
      orgId,
    );
    const result = await reviewed.run(intake, "import");
    expect(result.totals.FAILED ?? 0).toBe(0);
    const mapping = await ctx.prisma.legacyRecord.findUniqueOrThrow({
      where: {
        sourceSystem_entity_sourceId: {
          sourceSystem: t.sourceSystem,
          entity: "ncrs",
          sourceId: "dst-ncr",
        },
      },
    });
    expect(
      (
        await ctx.prisma.nonconformance.findUniqueOrThrow({
          where: { id: mapping.targetId! },
        })
      ).createdAt.toISOString(),
    ).toBe("2026-11-01T07:30:00.000Z");
  });
});
