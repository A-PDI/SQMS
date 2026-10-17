import { createRequire } from "node:module";
import path from "node:path";
import { STANDARD_PLANS } from "@sqms/legacy-domain";
import {
  createTeam,
  createUser,
  expectStatus,
  login,
  startApp,
  uniq,
  type Session,
  type Team,
  type TestContext,
} from "./helpers";
const requireFixture = createRequire(
  path.resolve(__dirname, "../../..", "packages/legacy-domain/index.js"),
);
const { benchReport } = requireFixture("./test/helpers/benchData") as {
  benchReport(options: Record<string, unknown>): any;
};
const { extractPdfText } = requireFixture("./test/helpers/testEnv") as {
  extractPdfText(buffer: Buffer): string[];
};

describe("Injector synchronization, reports and permanent repair evidence", () => {
  let ctx: TestContext,
    team: Team,
    lab: Session,
    repair: any,
    attempt: any,
    first: any,
    final: any;
  const part = uniq("715-"),
    report = uniq("recorded-"),
    serial = "260521828A";
  beforeAll(async () => {
    ctx = await startApp({
      SUPPLIER_PORTAL_ENABLED: "false",
      CARBONZAPP_MODE: "recorded",
    });
    team = await createTeam(ctx);
    const user = await createUser(ctx.prisma, { roles: ["TEST_LAB"] });
    lab = await login(ctx, user.email);
  });
  afterAll(async () => ctx.close());
  const sync = (reports: any[]) =>
    lab.post("/injector-tests/sync-recorded", { mode: "recorded", reports });
  it("deduplicates report/slot identity, retains DNF, excludes bench reruns and denies unauthorized synchronization", async () => {
    const bad = benchReport({
      id: report,
      part,
      serial,
      datetime: "2026-06-29T16:00:00Z",
      flow: { IVM01: 250 },
    });
    const interrupted = benchReport({
      id: report,
      slot: 1,
      part,
      serial: "OTHER-009",
      datetime: "2026-06-29T16:01:00Z",
      errorOn: "IVM01",
      flow: { IVM01: null, IVM06: null, IVM06_RETURN: null },
    });
    expect(
      (
        await team.engineer.session.post("/injector-tests/sync-recorded", {
          mode: "recorded",
          reports: [bad],
        })
      ).status,
    ).toBe(403);
    const r = expectStatus(
      await sync([
        bad,
        interrupted,
        benchReport({ id: uniq(), serial: "R2600001" }),
        benchReport({ id: uniq(), job: "SHOP-RMA-12" }),
      ]),
      201,
    ).body;
    expect(r).toMatchObject({ imported: 2, updated: 0 });
    expect(r.excluded).toHaveLength(2);
    expect(
      expectStatus(await sync([bad, interrupted]), 201).body,
    ).toMatchObject({ imported: 0, unchanged: 2 });
    const tests = await ctx.prisma.injectorTest.findMany({
      where: { reportExternalId: report },
    });
    first = tests.find((t) => t.slotPosition === 0);
    const stepFiltered = expectStatus(
      await lab.get(
        `/injector-tests?partNumber=${encodeURIComponent(part)}&stepCodes=IVM01&stepStatus=fail`,
      ),
      200,
    ).body;
    expect(stepFiltered.items.map((r: any) => r.id)).toEqual([first.id]);
    expect(first.outcome).toBe("fail");
    expect(tests.find((t) => t.slotPosition === 1)?.outcome).toBe("dnf");
    expect(
      (await sync([bad, { ...bad, actuator_code: "conflicting-part" }])).status,
    ).toBe(422);
    expect(
      await ctx.prisma.injectorTest.count({
        where: { reportExternalId: report },
      }),
    ).toBe(2);
    expect((await lab.post("/injector-tests/sync", {})).status).toBe(409);
  });
  it("records quick measurements atomically, protects duplicates, and requires a review before linking a retest on hold", async () => {
    const quick = expectStatus(
      await lab.get(`/injector-tests/${first.id}/quick-entry`),
      200,
    ).body;
    expect(quick.canSave).toBe(true);
    const r = expectStatus(
      await lab.post(`/injector-tests/${first.id}/quick-entry`, {
        repairDate: "2026-06-29",
        measurements: [
          {
            key: "armature_stroke",
            before_value: ".10",
            after_value: ".12",
            unit: "mm",
          },
        ],
      }),
      201,
    ).body;
    repair = expectStatus(
      await lab.get(`/injector-repairs/${r.caseId}`),
      200,
    ).body;
    attempt = repair.attempts[0];
    expect(repair.attempts).toHaveLength(1);
    expect(attempt.changes[0]).toMatchObject({
      parameter: "Armature Stroke",
      before_value: ".10",
      after_value: ".12",
    });
    expect(
      (
        await lab.post(`/injector-tests/${first.id}/quick-entry`, {
          repairDate: "2026-06-29",
          measurements: [
            {
              key: "armature_stroke",
              before_value: ".10",
              after_value: ".12",
              unit: "mm",
            },
          ],
        })
      ).status,
    ).toBe(409);
    repair = expectStatus(
      await lab.post(`/injector-repairs/${repair.id}/status`, {
        expectedVersion: repair.version,
        status: "HOLD",
        reason: "Engineering review of needle adjustment",
      }),
      201,
    ).body;
    const passed = benchReport({
      id: uniq("retest-"),
      part,
      serial: "828",
      datetime: "2026-06-30T16:00:00Z",
    });
    expectStatus(await sync([passed]), 201);
    final = await ctx.prisma.injectorTest.findUniqueOrThrow({
      where: {
        reportExternalId_slotPosition: {
          reportExternalId: passed._id,
          slotPosition: 0,
        },
      },
    });
    expect(
      (
        await lab.post(`/injector-repairs/attempts/${attempt.id}/retest`, {
          expectedVersion: attempt.version,
          afterTestId: final.id,
          observedOutcome: "Flow within original green acceptance bands",
        })
      ).status,
    ).toBe(422);
    repair = expectStatus(
      await lab.post(`/injector-repairs/${repair.id}/status`, {
        expectedVersion: repair.version,
        status: "OPEN",
        reason: "Engineering authorized the retest review",
      }),
      201,
    ).body;
    attempt = expectStatus(
      await lab.post(`/injector-repairs/attempts/${attempt.id}/retest`, {
        expectedVersion: attempt.version,
        afterTestId: final.id,
        observedOutcome: "Flow within original green acceptance bands",
      }),
      201,
    ).body;
    expect(attempt.status).toBe("COMPLETED");
    expect(attempt.outcome).toBe("PASS");
    expect(
      attempt.deltas.find((d: any) => d.before?.stepCode === "IVM01"),
    ).toMatchObject({ compatible: true, absolute: -20, effectiveness: 100 });
    expect(
      (
        await ctx.prisma.injectorRepairCase.findUniqueOrThrow({
          where: { id: repair.id },
        })
      ).status,
    ).toBe("PASSED");
    expect(
      (
        await lab.post(`/injector-repairs/${repair.id}/status`, {
          expectedVersion: repair.version + 1,
          status: "OPEN",
          reason: "Try to rewrite completed repair",
        })
      ).status,
    ).toBe(422);
  });
  it("keeps abbreviated serial aliases in one physical unit and preserves report order, specification bands and numeric values", async () => {
    const a = expectStatus(
      await lab.get("/injector-tests/analytics"),
      200,
    ).body;
    const detailed = expectStatus(
      await lab.get(
        `/injector-tests/analytics/detail?part_number=${encodeURIComponent(part)}&interval=day`,
      ),
      200,
    ).body;
    expect(detailed.testing).toMatchObject({
      test_runs: 3,
      unique_injectors: 2,
      first_outcomes: { FAIL: 1, DNF: 1 },
      latest_outcomes: { PASS: 1, DNF: 1 },
    });
    expect(detailed.repairs).toMatchObject({ cases: 1, passed_after_one: 1 });
    expect(a.testCount).toBeGreaterThanOrEqual(3);
    const preview = expectStatus(
      await lab.post("/injector-tests/report-preview", {
        ids: [final.id, first.id],
      }),
      201,
    ).body;
    expect(preview.injectors.map((i: any) => i.serialNumber)).toEqual([
      "828",
      serial,
    ]);
    expect(JSON.stringify(preview)).toContain("250");
    expect(JSON.stringify(preview)).toContain("230");
    const pdf = expectStatus(
      await lab.post("/injector-tests/reports", {
        ids: [final.id, first.id],
        format: "customer",
        vendorName: "Acceptance fixture",
      }),
      201,
    );
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    const text = extractPdfText(pdf.body).join(" ");
    for (const expected of [
      "Acceptance fixture",
      "Peak HP",
      "250",
      "230",
      part,
    ])
      expect(text).toContain(expected);
    expect(text.replace(/\s/g, "")).toContain(serial);
    const workbook = expectStatus(
      await lab
        .get(
          `/injector-tests/analytics/export.xlsx?part_number=${encodeURIComponent(part)}`,
        )
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
          res.on("end", () => done(null, Buffer.concat(chunks)));
          res.on("error", done);
        }),
      200,
    );
    expect(workbook.body.subarray(0, 2).toString()).toBe("PK");
    const book = new (requireFixture("exceljs").Workbook)();
    await book.xlsx.load(workbook.body);
    expect(book.worksheets.map((s: any) => s.name)).toContain(
      "Repair attempts",
    );
  });
  it("converts selected bench tests into one idempotent draft inspection with per-item evidence and an immutable plan snapshot", async () => {
    const definition = STANDARD_PLANS.find((p) => p.form_no === "PDI-IQI-012");
    let p = await ctx.prisma.inspectionPlan.findUnique({
      where: { code: "PDI-IQI-012" },
      include: { revisions: true },
    });
    if (!p)
      p = expectStatus(
        await team.engineer.session.post("/inspection-plans", {
          code: "PDI-IQI-012",
          title: definition.title,
          definition,
        }),
        201,
      ).body;
    const rev =
      p!.revisions.find((r) => r.status === "RELEASED") ??
      expectStatus(
        await team.engineer.session.post(
          `/inspection-plans/revisions/${p!.revisions[0].id}/release`,
          {},
        ),
        201,
      ).body;
    const dto = { ids: [first.id, final.id], planRevisionId: rev.id };
    const firstInspection = expectStatus(
      await lab.post("/injector-tests/inspection", dto),
      201,
    ).body;
    const retry = expectStatus(
      await lab.post("/injector-tests/inspection", dto),
      201,
    ).body;
    expect(retry.id).toBe(firstInspection.id);
    const r = expectStatus(
      await lab.get(`/incoming-inspections/${firstInspection.id}`),
      200,
    ).body;
    expect(r.status).toBe("DRAFT");
    expect(r.productApprovalId).toBeNull();
    expect(r.planSnapshot.benchConversion.testIds).toEqual(dto.ids);
    expect(r.sectionData.__items.map((i: any) => i.__serial_no)).toEqual([
      serial,
      "828",
    ]);
    expect(
      r.sectionData.__items[0].dimensional.some(
        (v: any) => String(v.actual1) === "250",
      ),
    ).toBe(true);
    const pdf = expectStatus(
      await lab.get(`/incoming-inspections/${r.id}/pdf`),
      200,
    );
    const text = extractPdfText(pdf.body).join(" ");
    expect(text).toContain("250");
    expect(text).toContain(serial);
    expect(
      (
        await lab.post(`/incoming-inspections/${r.id}/complete`, {
          expectedVersion: r.version,
        })
      ).status,
    ).toBe(422); // Failed bench evidence needs inspector notes/photos.
  });

  it("automatically links an unambiguous later recorded retest once without changing approvals", async () => {
    const p = uniq("AUTO-"),
      id = uniq("before-");
    expectStatus(
      await sync([
        benchReport({
          id,
          part: p,
          serial: "260521777A",
          datetime: "2026-06-29T16:00:00Z",
          flow: { IVM01: 250 },
        }),
      ]),
      201,
    );
    const before = await ctx.prisma.injectorTest.findUniqueOrThrow({
      where: {
        reportExternalId_slotPosition: {
          reportExternalId: id,
          slotPosition: 0,
        },
      },
    });
    const c = expectStatus(
      await lab.post(`/injector-tests/${before.id}/quick-entry`, {
        repairDate: "2026-06-29",
        measurements: [
          {
            key: "needle_stroke",
            before_value: ".10",
            after_value: ".12",
            unit: "mm",
          },
        ],
      }),
      201,
    ).body;
    const count = await ctx.prisma.productApproval.count();
    const after = benchReport({
      id: uniq("after-"),
      part: p,
      serial: "777",
      datetime: "2026-06-30T16:00:00Z",
    });
    expect(expectStatus(await sync([after]), 201).body.linkedRetests).toBe(1);
    expect(expectStatus(await sync([after]), 201).body.linkedRetests).toBe(0);
    const saved = expectStatus(
      await lab.get(`/injector-repairs/${c.caseId}`),
      200,
    ).body;
    expect(saved.status).toBe("PASSED");
    expect(saved.attempts).toHaveLength(1);
    expect(await ctx.prisma.productApproval.count()).toBe(count);
  });
});
