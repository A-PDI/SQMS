import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { hashPassword, verifyPassword, passwordNeedsRehash } from "@sqms/db";
import { STANDARD_PLANS } from "@sqms/legacy-domain";
import { cleanUpload } from "./flows";
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

describe("Operational inspection preservation and controls", () => {
  let ctx: TestContext, team: Team, inspector: Session, manager: Session;
  let part: { id: string },
    feature: { id: string },
    plan: any,
    revision: any,
    inspection: any;
  beforeAll(async () => {
    ctx = await startApp({ SUPPLIER_PORTAL_ENABLED: "false" });
    team = await createTeam(ctx);
    const i = await createUser(ctx.prisma, { roles: ["INSPECTOR"] });
    inspector = await login(ctx, i.email);
    const m = await createUser(ctx.prisma, { roles: ["QUALITY_MANAGER"] });
    manager = await login(ctx, m.email);
    part = await ctx.prisma.internalPart.create({
      data: {
        partNumber: uniq("001-"),
        description: "Unresolved supplier part",
      },
    });
    feature = expectStatus(
      await team.engineer.session.post("/features", {
        internalPartId: part.id,
        key: "bore-axis",
        name: "Main housing bore",
      }),
      201,
    ).body;
  });
  afterAll(async () => ctx.close());
  it("retains all current source form definitions and keeps ordinary Quality authority separate from administration", async () => {
    expect(new Set(STANDARD_PLANS.map((p) => p.form_no)).size).toBe(30);
    for (const code of [
      "PDI-IQI-005",
      "PDI-IQI-006",
      "PDI-IQI-012",
      "PDI-IQI-029",
      "PDI-IQI-MISC",
    ])
      expect(STANDARD_PLANS.some((p) => p.form_no === code)).toBe(true);
    expect((await inspector.post("/inspection-plans", {})).status).toBe(403);
    expect((await manager.get("/admin/users")).status).toBe(403);
    expect((await inspector.post("/incoming-inspections", {})).status).toBe(
      400,
    );
  });
  it("releases immutable plan revisions and creates a two-item receipt with supplier uncertainty preserved", async () => {
    const definition = {
      sections: {
        receiving: {
          title: "Receiving",
          section_type: "pfn_checklist",
          items: [{ id: 1, name: "Label", requirement: "Matches PO" }],
        },
      },
      characteristics: [
        {
          key: "bore",
          name: "Housing bore",
          featureId: feature.id,
          sectionKey: "measurements",
          unit: "mm",
          minimum: 24.98,
          maximum: 25.02,
          method: "Bore micrometer",
          defectCode: "DIMENSIONAL",
        },
      ],
    };
    plan = expectStatus(
      await team.engineer.session.post("/inspection-plans", {
        code: uniq("IQI-"),
        title: "Housing inspection",
        definition,
      }),
      201,
    ).body;
    const receipt = {
      planRevisionId: plan.revisions[0].id,
      internalPartId: part.id,
      originalPartNumber: "001-A.02",
      itemCount: 2,
      header: { po_number: "PO-001", date_received: "2026-10-16" },
      resolutionNotes: "Supplier cannot yet be established from PO evidence",
    };
    expect(
      (await inspector.post("/incoming-inspections", receipt)).status,
    ).toBe(422);
    revision = expectStatus(
      await team.engineer.session.post(
        `/inspection-plans/revisions/${plan.revisions[0].id}/release`,
      ),
      201,
    ).body;
    await expect(
      ctx.prisma.inspectionPlanRevision.update({
        where: { id: revision.id },
        data: { definition: { sections: {} } },
      }),
    ).rejects.toThrow();
    await expect(
      ctx.prisma.inspectionPlanRevision.delete({ where: { id: revision.id } }),
    ).rejects.toThrow();
    inspection = expectStatus(
      await inspector.post("/incoming-inspections", receipt),
      201,
    ).body;
    expect(inspection.supplierId).toBeNull();
    expect(inspection.productApprovalId).toBeNull();
    expect(inspection.resolutionNotes).toContain("Supplier");
    expect(inspection.sectionData.__shared.receiving).toHaveLength(1);
    expect(inspection.sectionData.__items).toHaveLength(2);
  });
  it("snapshots specification and values, requires failure evidence, and atomically creates the uppercase FAIL alert", async () => {
    const data = {
      __shared: { receiving: [{ id: 1, status: "P" }] },
      __items: [
        {
          __serial_no: "00001",
          __disposition: "FAIL",
          __disposition_notes: "Housing bore measured above upper limit",
        },
        { __serial_no: "00002", __disposition: "PASS" },
      ],
    };
    inspection = expectStatus(
      await inspector.patch(`/incoming-inspections/${inspection.id}`, {
        expectedVersion: inspection.version,
        sectionData: data,
        measurements: [
          { itemPosition: 0, characteristicKey: "bore", value: 25.06 },
          { itemPosition: 1, characteristicKey: "bore", value: 25.0 },
        ],
      }),
      200,
    ).body;
    expect(
      (
        await inspector.post(
          `/incoming-inspections/${inspection.id}/complete`,
          { expectedVersion: inspection.version },
        )
      ).status,
    ).toBe(422);
    expect(
      await ctx.prisma.operationalAlert.count({
        where: { inspectionId: inspection.id },
      }),
    ).toBe(0);
    const evidence = await cleanUpload(ctx, inspector);
    const attachment = expectStatus(
      await inspector.post("/record-attachments", {
        entityType: "INCOMING_INSPECTION",
        entityId: inspection.id,
        fileId: evidence.id,
        context: { itemPosition: 0 },
      }),
      201,
    ).body;
    inspection = expectStatus(
      await inspector.post(`/incoming-inspections/${inspection.id}/complete`, {
        expectedVersion: inspection.version,
      }),
      201,
    ).body;
    expect(inspection.status).toBe("COMPLETE");
    expect(inspection.disposition).toBe("FAIL");
    expect(
      (
        await ctx.prisma.operationalAlert.findMany({
          where: { inspectionId: inspection.id },
        })
      ).map((a) => a.type),
    ).toEqual(["inspection_failure"]);
    expect(
      await ctx.prisma.outboxEvent.count({
        where: { aggregateId: inspection.id, eventType: "incoming.completed" },
      }),
    ).toBe(1);
    expect(
      (
        await inspector.post(
          `/incoming-inspections/${inspection.id}/complete`,
          { expectedVersion: inspection.version - 1 },
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await inspector.patch(`/incoming-inspections/${inspection.id}`, {
          expectedVersion: inspection.version,
          sectionData: data,
        })
      ).status,
    ).toBe(409);
    expect(
      (await inspector.delete(`/record-attachments/${attachment.id}`)).status,
    ).toBe(409);
    expect(
      (
        await team.readOnly.session.delete(
          `/record-attachments/${attachment.id}`,
        )
      ).status,
    ).toBe(403);
    const measurements = await ctx.prisma.incomingMeasurement.findMany({
      where: { inspectionId: inspection.id },
      orderBy: { value: "desc" },
    });
    expect(measurements[0].outcome).toBe("FAIL");
    expect(measurements[0].specification).toMatchObject({
      maximum: 25.02,
      unit: "mm",
      method: "Bore micrometer",
      planRevisionId: revision.id,
    });
    const pdf = await inspector.get(
      `/incoming-inspections/${inspection.id}/pdf`,
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
  });
  it("reopens only with dedicated authority and preserves the prior completion and measurements", async () => {
    expect(
      (
        await inspector.post(`/incoming-inspections/${inspection.id}/reopen`, {
          expectedVersion: inspection.version,
          reason: "Correction approved",
        })
      ).status,
    ).toBe(403);
    const r = expectStatus(
      await manager.post(`/incoming-inspections/${inspection.id}/reopen`, {
        expectedVersion: inspection.version,
        reason: "Correct transcribed serial number from receipt label",
      }),
      201,
    ).body;
    expect(r.status).toBe("IN_PROGRESS");
    const events = await ctx.prisma.auditEvent.findMany({
      where: { entityId: inspection.id, eventType: "incoming.reopened" },
    });
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toMatchObject({
      completedRecord: { disposition: "FAIL", version: inspection.version },
    });
    expect(
      await ctx.prisma.incomingMeasurement.count({
        where: { inspectionId: inspection.id },
      }),
    ).toBe(2);
  });
  it("represents internal NCRs and denies mismatched or absent relational origins", async () => {
    const body = {
      title: "Internal packaging finding",
      dateIdentified: "2026-10-16",
      source: "INTERNAL",
      quantityAffected: 1,
      defectDescription: "Internal packaging material damaged before receiving",
      severity: "MINOR",
    };
    const n = expectStatus(await inspector.post("/ncrs", body), 201).body;
    expect(n.supplierId).toBeNull();
    expect(n.internalPartId).toBeNull();
    expect(
      (
        await inspector.post("/ncrs", {
          ...body,
          source: "INCOMING_INSPECTION",
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await inspector.post("/ncrs", {
          ...body,
          source: "FIRST_ARTICLE",
          firstArticleId: randomUUID(),
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await inspector.post("/ncrs", {
          ...body,
          incomingInspectionId: inspection.id,
        })
      ).status,
    ).toBe(422);
  });
  it("supports bcrypt only through legacy verification and rehashes after successful login", async () => {
    const bcrypt = createRequire(require.resolve("@sqms/db"))("bcryptjs") as {
      hash(password: string, rounds: number): Promise<string>;
    };
    const password = "Migrated-Password-123!";
    const hash = await bcrypt.hash(password, 4);
    expect(await verifyPassword(hash, password)).toBe(true);
    expect(passwordNeedsRehash(hash)).toBe(true);
    expect(await verifyPassword(hash, "wrong-password")).toBe(false);
    const user = await createUser(ctx.prisma, { roles: ["INSPECTOR"] });
    await ctx.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash },
    });
    await login(ctx, user.email, password);
    const after = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(after.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(after.passwordHash!, password)).toBe(true);
    expect(await verifyPassword(await hashPassword(password), password)).toBe(
      true,
    );
  });
  it("creates local accounts without email and prevents ordinary Quality Managers from granting administrator authority", async () => {
    const adminUser = await createUser(ctx.prisma, { roles: ["SYSTEM_ADMIN"] });
    const admin = await login(ctx, adminUser.email);
    const account = {
      email: `${uniq("new-inspector-")}@test.local`,
      displayName: "Provisioned inspector",
      password: "Local-Account-Only-123!",
      roleKeys: ["INSPECTOR"],
    };
    expect((await manager.post("/admin/users/local", account)).status).toBe(
      403,
    );
    const created = expectStatus(
      await admin.post("/admin/users/local", account),
      201,
    ).body;
    expect(JSON.stringify(created)).not.toMatch(/password|argon2|\$2[aby]/i);
    const session = await login(ctx, account.email, account.password);
    expect((await session.get("/incoming-inspections")).status).toBe(200);
    expect((await session.get("/admin/users")).status).toBe(403);
    expect((await admin.post("/admin/users/local", account)).status).toBe(409);
  });
  it("enforces per-row photo evidence, raises a raw-form NCR, preserves captions in PDF and protects a completed report", async () => {
    const p = expectStatus(
      await manager.post("/inspection-plans", {
        code: uniq("CUSTOM-"),
        title: "Custom cosmetic check",
        definition: {
          sections: {
            visual: {
              title: "Visual",
              section_type: "pass_fail_checklist",
              items: [
                { id: 8, name: "Surface finish", requirement: "No gouges" },
              ],
            },
          },
        },
      }),
      201,
    ).body;
    const rev = expectStatus(
      await manager.post(
        `/inspection-plans/revisions/${p.revisions[0].id}/release`,
      ),
      201,
    ).body;
    let r = expectStatus(
      await inspector.post("/incoming-inspections", {
        planRevisionId: rev.id,
        itemCount: 1,
        resolutionNotes: "Supplier attribution awaiting purchasing review",
        originalPartNumber: "00001-SURFACE-A.02",
        originalSupplier: "Fixture unmapped shop",
        header: { po_number: "PO-PHOTO-001" },
      }),
      201,
    ).body;
    const data = {
      __items: [
        {
          __serial_no: "PHOTO-001",
          __disposition: "FAIL",
          __disposition_notes: "Reject gouged surface",
          visual: [
            { id: 8, result: "F", notes: "Deep gouge on mounting face" },
          ],
        },
      ],
    };
    r = expectStatus(
      await inspector.patch(`/incoming-inspections/${r.id}`, {
        expectedVersion: r.version,
        sectionData: data,
      }),
      200,
    ).body;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
    const file = await cleanUpload(ctx, inspector, "surface.png", png);
    expectStatus(
      await inspector.post("/record-attachments", {
        entityType: "INCOMING_INSPECTION",
        entityId: r.id,
        fileId: file.id,
        context: { itemPosition: 0 },
      }),
      201,
    );
    expect(
      (
        await inspector.post(`/incoming-inspections/${r.id}/complete`, {
          expectedVersion: r.version,
        })
      ).status,
    ).toBe(422);
    expectStatus(
      await inspector.post("/record-attachments", {
        entityType: "INCOMING_INSPECTION",
        entityId: r.id,
        fileId: file.id,
        context: { itemPosition: 0, sectionKey: "visual", rowId: "8" },
      }),
      201,
    );
    r = expectStatus(
      await inspector.post(`/incoming-inspections/${r.id}/complete`, {
        expectedVersion: r.version,
      }),
      201,
    ).body;
    let n = expectStatus(
      await inspector.post(`/incoming-inspections/${r.id}/ncrs`, {
        title: "Gouge on mounting face",
        resultIds: [],
        itemPositions: [0],
        quantityAffected: 1,
        defectCode: "VISUAL",
      }),
      201,
    ).body;
    expect(n.purchaseOrder).toBe("PO-PHOTO-001");
    expect(n.serialNumbers).toBe("PHOTO-001");
    expectStatus(
      await inspector.post(`/ncrs/${n.id}/report-sections`, {
        expectedVersion: n.version,
        sections: [
          {
            title: "Observed condition",
            body: "Gouge extends across the mounting face",
          },
        ],
      }),
      201,
    );
    n = expectStatus(await inspector.get(`/ncrs/${n.id}`), 200).body;
    expect(n.internalPart).toBeNull();
    expect(n.supplier).toBeNull();
    expect(n.incomingInspection.originalPartNumber).toBe("00001-SURFACE-A.02");
    const photo = expectStatus(
      await inspector.post("/record-attachments", {
        entityType: "NCR",
        entityId: n.id,
        fileId: file.id,
        description: "Mounting-face gouge",
        context: { reportSectionId: n.reportSections[0].id },
      }),
      201,
    ).body;
    expectStatus(
      await inspector.patch(`/record-attachments/${photo.id}`, {
        expectedVersion: photo.version,
        description: "Gouge beside mounting hole 2",
      }),
      200,
    );
    expect(
      (
        await inspector.patch(`/record-attachments/${photo.id}`, {
          expectedVersion: photo.version,
          description: "Lost update",
        })
      ).status,
    ).toBe(409);
    const pdf = expectStatus(await inspector.get(`/ncrs/${n.id}/pdf`), 200);
    const extract = createRequire(
      path.resolve(__dirname, "../../..", "packages/legacy-domain/index.js"),
    )("./test/helpers/testEnv").extractPdfText;
    const text = extract(pdf.body).join(" ");
    expect(text.replace(/\s/g, "")).toContain("00001-SURFACE-A.02");
    expect(text).toContain("Fixture unmapped shop");
    expect(text.toUpperCase()).toContain("OBSERVED CONDITION");
    expect(text).toContain("Gouge beside mounting hole 2");
    n = expectStatus(
      await manager.post(`/ncrs/${n.id}/disposition`, {
        expectedVersion: n.version,
        disposition: "SCRAP",
        dispositionNotes: "Reject the damaged component",
      }),
      201,
    ).body;
    expect(
      (
        await inspector.post(`/ncrs/${n.id}/report-sections`, {
          expectedVersion: n.version,
          sections: [],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await inspector.patch(`/record-attachments/${photo.id}`, {
          expectedVersion: photo.version + 1,
          description: "Rewrite controlled caption",
        })
      ).status,
    ).toBe(409);
  });
  it("produces reconciled custom-report totals and preserves saved report ownership", async () => {
    const report = expectStatus(
      await inspector.get(
        `/inspection-reports?planId=${plan.id}&groupBy=status`,
      ),
      200,
    ).body;
    expect(report.totals.count).toBe(1);
    expect(
      report.groups.reduce((sum: number, g: any) => sum + g.count, 0),
    ).toBe(report.totals.count);
    expect(report.details[0].id).toBe(inspection.id);
    expect(
      (
        await inspector.get(
          "/inspection-reports?dateFrom=2026-10-17&dateTo=2026-10-16",
        )
      ).status,
    ).toBe(422);
    const saved = expectStatus(
      await inspector.post("/saved-views", {
        module: "inspection-reports",
        name: uniq("My custom report "),
        filters: { planId: plan.id, groupBy: "status" },
      }),
      201,
    ).body;
    expect((await manager.delete(`/saved-views/${saved.id}`)).status).toBe(404);
    expect(
      (
        await inspector.post("/inspection-reports/export", {
          planId: plan.id,
          format: "pdf",
        })
      ).headers["content-type"],
    ).toContain("application/pdf");
  });
});
