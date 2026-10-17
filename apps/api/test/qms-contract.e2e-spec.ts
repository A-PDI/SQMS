import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  createUser,
  expectStatus,
  login,
  startApp,
  uniq,
  type Session,
  type TestContext,
} from "./helpers";
const requireFixture = createRequire(
  path.resolve(__dirname, "../../..", "packages/legacy-domain/index.js"),
);
const { benchReport } = requireFixture("./test/helpers/benchData");

describe("Original QMS screen contracts on SQMS", () => {
  let ctx: TestContext,
    admin: Session,
    inspector: Session,
    reader: Session,
    template: any,
    inspection: any,
    ncr: any;
  const part = uniq("001-"),
    serial = "260521828A";
  beforeAll(async () => {
    ctx = await startApp({
      SUPPLIER_PORTAL_ENABLED: "false",
      CARBONZAPP_MODE: "recorded",
    });
    admin = await login(ctx, "admin@test.local", "Admin-Test-Pass-1!");
    inspector = await login(
      ctx,
      (await createUser(ctx.prisma, { roles: ["INSPECTOR"] })).email,
    );
    reader = await login(
      ctx,
      (await createUser(ctx.prisma, { roles: ["READ_ONLY"] })).email,
    );
  });
  afterAll(async () => ctx.close());
  it("ships all 30 original forms and requires backend permissions on the compatibility routes", async () => {
    const forms = expectStatus(await admin.get("/qms/admin/templates"), 200)
      .body.templates;
    expect(forms.filter((t: any) => /^PDI-IQI-/.test(t.form_no))).toHaveLength(
      30,
    );
    expect(forms.find((t: any) => t.form_no === "PDI-IQI-006").active).toBe(0);
    expect(
      (await reader.post("/qms/inspections", { template_id: forms[0].id }))
        .status,
    ).toBe(403);
    expect((await inspector.post("/qms/admin/templates", {})).status).toBe(403);
    expect((await admin.get("/qms/no-such-route")).status).toBe(404);
  });
  it("keeps original local account and password-dialog payloads while using SQMS sessions", async () => {
    const email = uniq("local-") + "@qms.fixture";
    const created = expectStatus(
      await admin.post("/qms/admin/users", {
        name: "Original local account",
        email,
        password: "Qms123!!",
        role: "inspector",
        active: 1,
        usePermissions: true,
        permTabs: ["new_inspection", "my_inspections"],
      }),
      200,
    ).body.user;
    expect(JSON.parse(created.permissions).tabs).toEqual([
      "new_inspection",
      "my_inspections",
    ]);
    const local = await login(ctx, email, "Qms123!!");
    expectStatus(
      await local.patch("/qms/auth/password", {
        current_password: "Qms123!!",
        new_password: "Next123!",
      }),
      200,
    );
    await login(ctx, email, "Next123!");
  });
  it("accepts original admin form and catalogue payloads, with catalogue-only autocomplete", async () => {
    template = expectStatus(
      await admin.post("/qms/admin/templates", {
        form_no: uniq("PARITY-"),
        title: "Original form",
        component_type: "custom",
        header_schema: [],
        disposition_type: "pass_fail",
        sections: {
          visual: {
            title: "Visual",
            section_type: "pfn_visual",
            items: [{ id: 1, name: "Surface", requirement: "No damage" }],
          },
        },
      }),
      200,
    ).body.template;
    expect(template.id).toBeTruthy();
    const spec = expectStatus(
      await admin.post("/qms/part-specs", {
        template_id: template.id,
        part_number: part,
        description: "Catalogue part",
        spec_data: { visual: [{ id: 1, requirement: "No damage" }] },
      }),
      200,
    ).body.spec;
    expect(spec.part_number).toBe(part);
    expect(
      (await admin.get(`/qms/part-specs/lookup?q=${part}`)).body.results[0]
        .source,
    ).toBe("catalogue");
  });
  it("runs the original create, assignment, multi-item save, completion, reopen and PDF workflow", async () => {
    inspection = expectStatus(
      await admin.post("/qms/inspections", {
        template_id: template.id,
        part_number: part,
        po_number: "PO-PARITY",
        inspector_name: "Original inspector",
        date_received: "2026-10-17",
        assigned_to: inspector.userId,
        due_date: "2026-10-19",
        item_count: 2,
        lot_serial_no: "A, B",
      }),
      200,
    ).body.inspection;
    const data = {
      __shared: { receiving: [] },
      __items: [
        { __serial_no: "A", visual: [{ id: 1, result: "PASS", remarks: "" }] },
        {
          __serial_no: "B",
          visual: [{ id: 1, result: "FAIL", remarks: "Scratch" }],
        },
      ],
      __admin_sections: template.sections,
    };
    expectStatus(
      await inspector.patch(`/qms/inspections/${inspection.id}`, {
        section_data: data,
        status: "partially_complete",
        disposition: "FAIL",
      }),
      200,
    );
    expect(
      (await inspector.get(`/qms/inspections/${inspection.id}`)).body.inspection
        .section_data,
    ).toEqual(data);
    expect(
      (await inspector.get("/qms/inspections/assigned")).body.inspections.some(
        (r: any) => r.id === inspection.id,
      ),
    ).toBe(true);
    expectStatus(
      await inspector.post(`/qms/inspections/${inspection.id}/complete`),
      200,
    );
    expect(
      (
        await inspector.patch(`/qms/inspections/${inspection.id}`, {
          section_data: {},
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await inspector.post(`/qms/inspections/${inspection.id}/reopen`, {
          reason: "Correction",
        })
      ).status,
    ).toBe(403);
    expectStatus(
      await admin.post(`/qms/inspections/${inspection.id}/reopen`, {
        reason: "Correct recorded surface finding",
      }),
      200,
    );
    expect(
      (await admin.get(`/qms/inspections/${inspection.id}`)).body.inspection
        .section_data,
    ).toEqual(data);
    expectStatus(
      await inspector.post(`/qms/inspections/${inspection.id}/complete`),
      200,
    );
    expect(
      await ctx.prisma.operationalAlert.count({
        where: { inspectionId: inspection.id, acknowledgedAt: null },
      }),
    ).toBe(1);
    const pdf = expectStatus(
      await admin.get(`/qms/inspections/${inspection.id}/pdf`),
      200,
    );
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.body.subarray(0, 4).toString()).toBe("%PDF");
  });
  it("edits a form using the same visible identity while preserving issued definitions, then creates a named version", async () => {
    const old = (
      await ctx.prisma.operationalTemplate.findUniqueOrThrow({
        where: { id: template.id },
      })
    ).currentRevisionId;
    const edited = expectStatus(
      await admin.patch(`/qms/admin/templates/${template.id}`, {
        title: "Edited original form",
        sections: {
          visual: { ...template.sections.visual, title: "Edited visual" },
        },
      }),
      200,
    ).body.template;
    expect(edited.id).toBe(template.id);
    expect(edited.title).toBe("Edited original form");
    expect(
      (
        await ctx.prisma.inspectionPlanRevision.findUniqueOrThrow({
          where: { id: old },
        })
      ).definition,
    ).toMatchObject({ title: "Original form" });
    expect(
      (await admin.get(`/qms/inspections/${inspection.id}`)).body.template
        .title,
    ).toBe("Original form");
    expect(
      (await admin.get(`/qms/part-specs?template_id=${template.id}`)).body
        .specs[0].part_number,
    ).toBe(part);
    const version = expectStatus(
      await admin.post(`/qms/admin/templates/${template.id}/version`, {
        revision: "B",
      }),
      200,
    ).body.template;
    expect(version.id).not.toBe(template.id);
    expect(version.parent_template_id).toBe(template.id);
    expect(
      (await admin.get("/qms/templates")).body.templates.some(
        (t: any) => t.id === template.id,
      ),
    ).toBe(false);
  });
  it("saves the original NCR fields and narrative sections without losing the original disposition vocabulary", async () => {
    ncr = expectStatus(
      await inspector.post("/qms/ncrs", {
        inspection_id: inspection.id,
        part_number: part,
        supplier: "Unattributed original text",
        po_number: "PO-PARITY",
        quantity_affected: 1,
        description_of_defect: "Surface scratch",
        severity: "major",
        ncr_disposition: "other",
        corrective_action_required: 1,
        corrective_action_due_date: "2026-11-01",
      }),
      200,
    ).body.ncr;
    expect(ncr.ncr_number).toMatch(/^NCR-\d{4,}$/);
    expect(ncr.ncr_disposition).toBe("other");
    expect(ncr.corrective_action_required).toBe(1);
    const content = expectStatus(
      await inspector.put(`/qms/ncrs/${ncr.id}/content`, {
        sections: [
          { title: "Investigation", body: "Original narrative", images: [] },
        ],
        photos: [],
        removed_image_ids: [],
      }),
      200,
    ).body;
    expect(content.sections[0].body).toBe("Original narrative");
    expect((await inspector.get(`/qms/ncrs/${ncr.id}`)).body.ncr.supplier).toBe(
      "Unattributed original text",
    );
    expect(
      (await inspector.get(`/qms/ncrs/${ncr.id}/pdf`)).headers["content-type"],
    ).toContain("application/pdf");
  });
  it("retains original saved report filters and exports both report formats", async () => {
    const config = { status: "Complete", group_by: "component_type" };
    const report = expectStatus(
      await admin.post("/qms/reports/saved", {
        name: uniq("Saved "),
        config_json: config,
      }),
      200,
    ).body.report;
    expect(
      (await admin.get("/qms/reports/saved")).body.reports.find(
        (r: any) => r.id === report.id,
      ).config_json,
    ).toEqual(config);
    expect(
      (await admin.post("/qms/reports/query", config)).body.totals.complete,
    ).toBeGreaterThan(0);
    expect(
      (await admin.post("/qms/reports/export/excel", config)).headers[
        "content-type"
      ],
    ).toContain("spreadsheetml");
    expect(
      (await admin.post("/qms/reports/export/pdf", config)).headers[
        "content-type"
      ],
    ).toContain("application/pdf");
  });
  it("restores original fields from retained snapshots when upgrading a previous import", async () => {
    const imported = expectStatus(
      await admin.post("/qms/ncrs", {
        description_of_defect: "Upgrade fixture",
        severity: "minor",
      }),
      200,
    ).body.ncr;
    await ctx.prisma
      .$executeRaw`UPDATE nonconformances SET qmsFields = NULL WHERE id = ${imported.id}`;
    await ctx.prisma.legacyRecord.create({
      data: {
        sourceSystem: "upgrade-fixture",
        entity: "ncrs",
        sourceId: imported.id,
        sourceHash: "a".repeat(64),
        targetType: "NCR",
        targetId: imported.id,
        snapshot: {
          corrective_action_required: 1,
          corrective_action_due_date: "2026-11-01",
          supplier: "Original unlinked supplier",
        },
      },
    });
    const sql = readFileSync(
      path.resolve(
        __dirname,
        "../../../packages/db/prisma/migrations/20261017020000_restore_original_contract_metadata/migration.sql",
      ),
      "utf8",
    ).replace(/^--.*$/gm, "");
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.startsWith("UPDATE")))
      await ctx.prisma.$executeRawUnsafe(statement);
    const restored = expectStatus(
      await admin.get(`/qms/ncrs/${imported.id}`),
      200,
    ).body.ncr;
    expect(restored.corrective_action_required).toBe(1);
    expect(restored.corrective_action_due_date).toBe("2026-11-01");
    expect(restored.supplier).toBe("Original unlinked supplier");
  });
  it("retains deleted source evidence while removing the NCR from both active views", async () => {
    expect((await inspector.delete(`/qms/ncrs/${ncr.id}`)).status).toBe(403);
    expectStatus(await admin.delete(`/qms/ncrs/${ncr.id}`), 200);
    expect((await admin.get(`/qms/ncrs/${ncr.id}`)).status).toBe(404);
    expect((await admin.get(`/ncrs/${ncr.id}`)).status).toBe(404);
    const active = expectStatus(
      await admin.get(`/ncrs?q=${ncr.ncr_number}`),
      200,
    ).body;
    expect(active.items).toHaveLength(0);
    expect(
      (
        await ctx.prisma.nonconformance.findUniqueOrThrow({
          where: { id: ncr.id },
        })
      ).archivedAt,
    ).toBeTruthy();
  });
  it("uses original injector report, repair and durable-history contracts", async () => {
    const raw = benchReport({
      id: uniq("qms-bench-"),
      part,
      serial,
      datetime: "2026-06-29T16:00:00Z",
      flow: { IVM01: 250 },
    });
    expectStatus(
      await admin.post("/injector-tests/sync-recorded", {
        mode: "recorded",
        reports: [raw],
      }),
      201,
    );
    const rows = expectStatus(
      await admin.get(`/qms/injector-tests?part_number=${part}`),
      200,
    ).body.injectors;
    expect(rows).toHaveLength(1);
    const id = rows[0].id;
    expect(
      (
        await admin.post("/qms/injector-tests/reports/preview", {
          injector_ids: [id],
        })
      ).body.preview,
    ).toBeTruthy();
    const workbook = expectStatus(
      await admin.post("/qms/injector-tests/reports/custom.xlsx", {
        injector_ids: [id],
      }),
      200,
    );
    expect(workbook.headers["content-type"]).toContain("spreadsheetml");
    const bad = await admin.post("/qms/injector-tests/repairs/cases", {
      initial_test_id: id,
      attempt: {
        technician: "Technician chosen in form",
        diagnosis: "Check flow",
        repair_date: "2026-06-29T17:00:00Z",
        changes: [],
      },
    });
    expect(bad.status).toBe(422);
    expect(
      await ctx.prisma.injectorRepairCase.count({
        where: { partNumber: part },
      }),
    ).toBe(0);
    const repair = expectStatus(
      await admin.post("/qms/injector-tests/repairs/cases", {
        initial_test_id: id,
        attempt: {
          technician: "Technician chosen in form",
          diagnosis: "Check flow",
          repair_date: "2026-06-29T17:00:00Z",
          changes: [
            {
              component: "Nozzle",
              action_type: "Inspected",
              parameter: "Flow",
            },
          ],
        },
      }),
      200,
    ).body.repair_case;
    expect(repair.attempts[0].technician).toBe("Technician chosen in form");
    expect(
      (await admin.get(`/qms/injector-tests/${id}/repair-history`)).body
        .active_case_id,
    ).toBe(repair.id);
    expectStatus(await admin.delete("/qms/injector-tests"), 200);
    expect(
      (await admin.get(`/qms/injector-tests/repairs/cases/${repair.id}`)).body
        .attempts[0].before_test_datetime,
    ).toBeTruthy();
  });
});
