import { approvedProduct, createApprovedSupplier, decideAll } from "./flows";
import { createTeam, createUser, expectStatus, login, startApp, type Session, type Team, type TestContext } from "./helpers";

describe("Nonconformance, deviations and corrective actions", () => {
  let ctx: TestContext;
  let team: Team;
  let product: Awaited<ReturnType<typeof approvedProduct>>;
  let supplierProductId: string;
  let otherSupplier: Awaited<ReturnType<typeof createApprovedSupplier>>;

  beforeAll(async () => {
    ctx = await startApp();
    team = await createTeam(ctx);
    product = await approvedProduct(ctx, team, { pathway: "B" });
    supplierProductId = (await ctx.prisma.productQualification.findUniqueOrThrow({ where: { id: product.qualificationId } })).supplierProductId;
    otherSupplier = await createApprovedSupplier(ctx, team);
  });
  afterAll(async () => {
    await ctx.close();
  });

  const ncrBody = (extra: Record<string, unknown> = {}) => ({
    title: "Housing bore oversize",
    dateIdentified: "2026-10-12",
    source: "INCOMING_INSPECTION",
    supplierProductId,
    lotNumber: "LOT-4471",
    quantityAffected: 40,
    quantityInspected: 125,
    defectDescription: "Bore diameter measured 52.06 mm against 52.00 +0.03 mm",
    expectedSpecification: "52.00 +0.03/-0.00 mm",
    actualCondition: "52.05 - 52.07 mm",
    severity: "MAJOR",
    internalNotes: "Suspect worn boring bar; second occurrence this quarter",
    ...extra,
  });
  const version = async (model: "nonconformance" | "correctiveAction" | "deviation", id: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((await (ctx.prisma[model] as any).findUniqueOrThrow({ where: { id } })) as { version: number }).version;

  it("runs an NCR through containment and disposition, requiring an approved concession for use-as-is", async () => {
    const ncr = expectStatus(await team.quality.session.post("/ncrs", ncrBody()), 201).body;
    expect(ncr.number).toMatch(/^NCR-\d{4}-\d{4}$/);
    expect(ncr.supplier.id).toBe(product.supplierId);
    expect(ncr.site.id).toBe(product.siteId);
    expect(ncr.status).toBe("OPEN");
    // References must agree: a site of another supplier is rejected.
    expect((await team.quality.session.post("/ncrs", ncrBody({ siteId: otherSupplier.site.id }))).status).toBe(422);
    expect((await team.readOnly.session.post("/ncrs", ncrBody())).status).toBe(403);

    expectStatus(await team.quality.session.post(`/ncrs/${ncr.id}/containment`, { expectedVersion: ncr.version, containmentAction: "Lot quarantined; 100% sort of stock", completed: true }), 201);
    expectStatus(await team.quality.session.post(`/ncrs/${ncr.id}/investigate`, { expectedVersion: await version("nonconformance", ncr.id) }), 201);

    // Use-as-is requires an approved concession linked to the NCR.
    const blocked = await team.quality.session.post(`/ncrs/${ncr.id}/disposition`, { expectedVersion: await version("nonconformance", ncr.id), disposition: "USE_AS_IS_CONCESSION", dispositionNotes: "Engineering accepts oversize for this lot" });
    expect(blocked.status).toBe(422);
    const concession = expectStatus(
      await team.quality.session.post("/deviations", { type: "CONCESSION", title: "Accept LOT-4471 bore oversize", ncrId: ncr.id, description: "Accept 40 housings with bore up to 52.07 mm", justification: "Clearance analysis shows no functional impact up to 52.08 mm", quantityLimit: 40, lotNumbers: "LOT-4471" }),
      201,
    ).body;
    expect(concession.supplierId).toBe(product.supplierId);
    expectStatus(await team.quality.session.post(`/deviations/${concession.id}/submit`, { expectedVersion: concession.version }), 201);
    expect((await team.quality.session.post(`/ncrs/${ncr.id}/disposition`, { expectedVersion: await version("nonconformance", ncr.id), disposition: "USE_AS_IS_CONCESSION", dispositionNotes: "Pending concession" })).status).toBe(422);
    await decideAll(ctx, team, concession.id);
    expect((await ctx.prisma.deviation.findUniqueOrThrow({ where: { id: concession.id } })).status).toBe("APPROVED");

    const disp = expectStatus(await team.quality.session.post(`/ncrs/${ncr.id}/disposition`, { expectedVersion: await version("nonconformance", ncr.id), disposition: "USE_AS_IS_CONCESSION", dispositionNotes: "Accepted under concession", deviationId: concession.id }), 201).body;
    expect(disp.status).toBe("DISPOSITIONED");
    expect(disp.disposition).toBe("USE_AS_IS_CONCESSION");
    expect((await team.engineer.session.post(`/ncrs/${ncr.id}/close`, { expectedVersion: disp.version, comment: "Closed" })).status).toBe(403);
    const closed = expectStatus(await team.quality.session.post(`/ncrs/${ncr.id}/close`, { expectedVersion: disp.version, comment: "Concession applied; SCAR raised for recurrence" }), 201).body;
    expect(closed.status).toBe("CLOSED");
    const events = await ctx.prisma.auditEvent.findMany({ where: { entityId: ncr.id }, select: { eventType: true } });
    expect(events.map((e) => e.eventType)).toEqual(expect.arrayContaining(["ncr.created", "ncr.containment_recorded", "ncr.investigation_started", "ncr.dispositioned", "ncr.closed"]));
  });

  it("blocks product approval while a blocking NCR is open against the configuration", async () => {
    const gateBefore = expectStatus(await team.quality.session.get(`/qualifications/${product.qualificationId}/gate`), 200).body as { key: string; passed: boolean }[];
    expect(gateBefore.find((g) => g.key === "nonconformances")!.passed).toBe(true);
    const ncr = expectStatus(await team.quality.session.post("/ncrs", ncrBody({ configurationRevisionId: product.revisionId, title: "Porosity in casting", source: "QUALIFICATION" })), 201).body;
    const gate = expectStatus(await team.quality.session.get(`/qualifications/${product.qualificationId}/gate`), 200).body as { key: string; passed: boolean; details: string[] }[];
    const check = gate.find((g) => g.key === "nonconformances")!;
    expect(check.passed).toBe(false);
    expect(check.details.join(" ")).toContain(ncr.number);
    expectStatus(await team.quality.session.post(`/ncrs/${ncr.id}/cancel`, { expectedVersion: ncr.version, reason: "Raised against wrong part" }), 201);
  });

  it("issues a SCAR from an NCR and requires an effective 8D response before closure", async () => {
    const ncr = expectStatus(await team.quality.session.post("/ncrs", ncrBody({ severity: "CRITICAL", title: "Recurring bore oversize" })), 201).body;
    const scar = expectStatus(await team.quality.session.post(`/ncrs/${ncr.id}/scar`, {}), 201).body;
    expect(scar.status).toBe("DRAFT");
    expect(scar.severity).toBe("CRITICAL");
    expect(scar.ncr.id).toBe(ncr.id);
    expect(scar.supplier.id).toBe(product.supplierId);
    expect(scar.responseDueDate.slice(0, 10) > new Date().toISOString().slice(0, 10)).toBe(true);

    // No responses until issued.
    expect((await team.quality.session.post(`/scars/${scar.id}/responses`, { submittedByName: "Supplier QE", d1Team: "Team" })).status).toBe(409);
    expectStatus(await team.quality.session.post(`/scars/${scar.id}/issue`, { expectedVersion: scar.version }), 201);
    // Content is controlled after issue.
    expect((await team.quality.session.patch(`/scars/${scar.id}`, { expectedVersion: await version("correctiveAction", scar.id), problemDescription: "Rewritten after issue" })).status).toBe(422);

    // Internal entry on the supplier's behalf must name the supplier representative.
    expect((await team.quality.session.post(`/scars/${scar.id}/responses`, { d1Team: "Team" })).status).toBe(422);
    const draft = expectStatus(await team.quality.session.post(`/scars/${scar.id}/responses`, { submittedByName: "Pat Supplier (QE)", d1Team: "QE, production lead, toolroom" }), 201).body;
    expect(draft.revisionNumber).toBe(1);
    const incomplete = await team.quality.session.post(`/scars/${scar.id}/responses/${draft.id}/submit`);
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.error.details.missing).toEqual(expect.arrayContaining(["d2Problem", "d4RootCause", "d7Prevention"]));
    const full = {
      submittedByName: "Pat Supplier (QE)",
      d2Problem: "Bore oversize on 40 pcs of LOT-4471",
      d3Containment: "Stock sorted; WIP on hold",
      d4RootCause: "Boring bar insert wear beyond change interval",
      d4EscapePoint: "SPC chart not reviewed on night shift",
      d5CorrectiveActions: "Tool life counter with forced change at 300 parts",
      d6Implementation: "Counter installed on OP30",
      d6ImplementationDate: "2026-10-20",
      d7Prevention: "Tool life management rolled out to all boring operations",
    };
    expectStatus(await team.quality.session.post(`/scars/${scar.id}/responses`, full), 201);
    expectStatus(await team.quality.session.post(`/scars/${scar.id}/responses/${draft.id}/submit`), 201);
    expect((await ctx.prisma.correctiveAction.findUniqueOrThrow({ where: { id: scar.id } })).status).toBe("RESPONSE_SUBMITTED");

    // Four-eyes: the person who entered the response cannot review it.
    expect((await team.quality.session.post(`/scars/${scar.id}/responses/${draft.id}/review`, { decision: "ACCEPTED", comment: "Looks fine" })).status).toBe(403);
    expectStatus(await team.quality2.session.post(`/scars/${scar.id}/responses/${draft.id}/review`, { decision: "REJECTED", comment: "Root cause not verified with data" }), 201);
    expect((await ctx.prisma.correctiveAction.findUniqueOrThrow({ where: { id: scar.id } })).status).toBe("RESPONSE_REJECTED");

    // Revised response is a new revision; the rejected one is retained.
    const rev2 = expectStatus(await team.quality.session.post(`/scars/${scar.id}/responses`, { ...full, d1Team: "QE, production lead, toolroom", d4RootCause: "Insert wear confirmed by tool-life study (attached)" }), 201).body;
    expect(rev2.revisionNumber).toBe(2);
    expectStatus(await team.quality.session.post(`/scars/${scar.id}/responses/${rev2.id}/submit`), 201);
    expectStatus(await team.quality2.session.post(`/scars/${scar.id}/responses/${rev2.id}/review`, { decision: "ACCEPTED", comment: "Root cause verified" }), 201);
    expect((await team.quality2.session.post(`/scars/${scar.id}/close`, { expectedVersion: await version("correctiveAction", scar.id), comment: "Close early" })).status).toBe(409);

    // Ineffective actions reopen the request.
    expectStatus(await team.quality2.session.post(`/scars/${scar.id}/effectiveness`, { expectedVersion: await version("correctiveAction", scar.id), result: "NOT_EFFECTIVE", notes: "Recurrence on LOT-4502" }), 201);
    let s = await ctx.prisma.correctiveAction.findUniqueOrThrow({ where: { id: scar.id } });
    expect(s.status).toBe("RESPONSE_REJECTED");
    expect(s.escalationLevel).toBe(1);
    const rev3 = expectStatus(await team.quality.session.post(`/scars/${scar.id}/responses`, { ...full, d1Team: "QE, production lead, toolroom", d5CorrectiveActions: "In-process gauging of every part at OP30" }), 201).body;
    expect(rev3.revisionNumber).toBe(3);
    expectStatus(await team.quality.session.post(`/scars/${scar.id}/responses/${rev3.id}/submit`), 201);
    expectStatus(await team.quality2.session.post(`/scars/${scar.id}/responses/${rev3.id}/review`, { decision: "ACCEPTED", comment: "Gauging adequate" }), 201);
    expectStatus(await team.quality2.session.post(`/scars/${scar.id}/effectiveness`, { expectedVersion: await version("correctiveAction", scar.id), result: "EFFECTIVE", notes: "Three lots without recurrence" }), 201);
    const closed = expectStatus(await team.quality2.session.post(`/scars/${scar.id}/close`, { expectedVersion: await version("correctiveAction", scar.id), comment: "Verified effective" }), 201).body;
    expect(closed.status).toBe("CLOSED");
    expect(closed.responses.map((r: { status: string }) => r.status)).toEqual(["ACCEPTED", "ACCEPTED", "REJECTED"]);
    s = await ctx.prisma.correctiveAction.findUniqueOrThrow({ where: { id: scar.id } });
    expect(s.effectivenessResult).toBe("EFFECTIVE");
  });

  it("flags overdue SCARs and filters them", async () => {
    const scar = expectStatus(await team.quality.session.post("/scars", { title: "Packaging damage", supplierId: product.supplierId, problemDescription: "Repeated transit damage to machined faces", severity: "MINOR" }), 201).body;
    expectStatus(await team.quality.session.post(`/scars/${scar.id}/issue`, { expectedVersion: scar.version }), 201);
    await ctx.prisma.correctiveAction.update({ where: { id: scar.id }, data: { responseDueDate: new Date(Date.UTC(2026, 0, 5)) } });
    const detail = expectStatus(await team.quality.session.get(`/scars/${scar.id}`), 200).body;
    expect(detail.overdue).toBe(true);
    const list = expectStatus(await team.quality.session.get("/scars?overdue=true&pageSize=100"), 200).body;
    expect(list.items.map((i: { id: string }) => i.id)).toContain(scar.id);
    expect(list.items.every((i: { overdue: boolean }) => i.overdue)).toBe(true);
    const csv = await team.quality.session.get("/scars/export.csv");
    expect(csv.status).toBe(200);
    expect(csv.text).toContain(scar.number);
  });

  describe("supplier portal view", () => {
    let portal: TestContext;
    let supplierUser: Session;
    let otherSupplierUser: Session;

    beforeAll(async () => {
      portal = await startApp({ SUPPLIER_PORTAL_ENABLED: "true" });
      const supplier = await ctx.prisma.supplier.findUniqueOrThrow({ where: { id: product.supplierId } });
      const u = await createUser(ctx.prisma, { roles: ["SUPPLIER_CONTRIBUTOR"], organizationId: supplier.organizationId, userType: "EXTERNAL" });
      supplierUser = await login(portal, u.email);
      const other = await ctx.prisma.supplier.findUniqueOrThrow({ where: { id: otherSupplier.supplier.id } });
      const o = await createUser(ctx.prisma, { roles: ["SUPPLIER_CONTRIBUTOR"], organizationId: other.organizationId, userType: "EXTERNAL" });
      otherSupplierUser = await login(portal, o.email);
    });
    afterAll(async () => {
      await portal.close();
    });

    it("hides internal notes, unshared NCRs and draft SCARs from suppliers and isolates other suppliers", async () => {
      const ncr = expectStatus(await team.quality.session.post("/ncrs", ncrBody({ title: "Shared NCR" })), 201).body;
      expect((await supplierUser.get(`/ncrs/${ncr.id}`)).status).toBe(404);
      expectStatus(await team.quality.session.patch(`/ncrs/${ncr.id}`, { expectedVersion: ncr.version, supplierVisible: true }), 200);
      const seen = expectStatus(await supplierUser.get(`/ncrs/${ncr.id}`), 200).body;
      expect(seen.internalNotes).toBeUndefined();
      expect(seen.defectDescription).toContain("52.06");
      expect((await otherSupplierUser.get(`/ncrs/${ncr.id}`)).status).toBe(404);
      const list = expectStatus(await otherSupplierUser.get("/ncrs?pageSize=100"), 200).body;
      expect(list.items.some((i: { id: string }) => i.id === ncr.id)).toBe(false);
      // Supplier IDs supplied by the client are ignored for external users.
      const spoof = expectStatus(await otherSupplierUser.get(`/ncrs?supplierId=${product.supplierId}&pageSize=100`), 200).body;
      expect(spoof.items.some((i: { supplierId: string }) => i.supplierId === product.supplierId)).toBe(false);
      expect((await supplierUser.post("/ncrs", ncrBody())).status).toBe(403);

      const scar = expectStatus(await team.quality.session.post(`/ncrs/${ncr.id}/scar`, {}), 201).body;
      expectStatus(await team.quality.session.patch(`/scars/${scar.id}`, { expectedVersion: scar.version, internalNotes: "Consider re-sourcing" }), 200);
      expect((await supplierUser.get(`/scars/${scar.id}`)).status).toBe(404);
      expectStatus(await team.quality.session.post(`/scars/${scar.id}/issue`, { expectedVersion: await version("correctiveAction", scar.id) }), 201);
      const issued = expectStatus(await supplierUser.get(`/scars/${scar.id}`), 200).body;
      expect(issued.internalNotes).toBeUndefined();
      expect((await otherSupplierUser.get(`/scars/${scar.id}`)).status).toBe(404);
      expect((await otherSupplierUser.post(`/scars/${scar.id}/responses`, { d1Team: "Not mine" })).status).toBe(404);

      // The supplier responds directly with its own permission.
      const resp = expectStatus(
        await supplierUser.post(`/scars/${scar.id}/responses`, { d1Team: "Supplier team", d2Problem: "Oversize bores", d3Containment: "Sorted", d4RootCause: "Tool wear", d5CorrectiveActions: "Tool life counter", d6Implementation: "Installed", d7Prevention: "Rolled out" }),
        201,
      ).body;
      expect(resp.submittedByOrganizationId).toBeTruthy();
      expectStatus(await supplierUser.post(`/scars/${scar.id}/responses/${resp.id}/submit`), 201);
      expect((await supplierUser.post(`/scars/${scar.id}/responses/${resp.id}/review`, { decision: "ACCEPTED", comment: "Self approve" })).status).toBe(403);
      expectStatus(await team.quality.session.post(`/scars/${scar.id}/responses/${resp.id}/review`, { decision: "ACCEPTED", comment: "Accepted" }), 201);
    });
  });
});
