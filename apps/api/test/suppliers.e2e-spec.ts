import { createTeam, expectStatus, startApp, uniq, type Team, type TestContext } from "./helpers";

describe("Supplier management & qualification", () => {
  let ctx: TestContext;
  let team: Team;

  beforeAll(async () => {
    ctx = await startApp();
    team = await createTeam(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it("creates a prospective supplier with sites, contacts and capabilities", async () => {
    const caps = await ctx.prisma.capability.findMany({ where: { code: { in: ["CNC_MACHINING", "PVD_COATING"] } } });
    const res = expectStatus(
      await team.sourcing.session.post("/suppliers", {
        name: `Turbo Dynamics ${uniq()}`,
        legalName: "Turbo Dynamics GmbH",
        country: "DE",
        website: "https://turbo.example.com",
        sites: [{ siteCode: "stuttgart", name: "Stuttgart Plant", city: "Stuttgart", country: "DE" }],
        contacts: [{ name: "Anna Weber", email: "anna@turbo.example.com", role: "Quality", isPrimary: true }],
        capabilityIds: caps.map((c) => c.id),
      }),
      201,
    );
    expect(res.body.status).toBe("PROSPECTIVE");
    expect(res.body.supplierNumber).toMatch(/^V\d{5}$/);
    const detail = expectStatus(await team.readOnly.session.get(`/suppliers/${res.body.id}`), 200);
    expect(detail.body.sites[0].siteCode).toBe("STUTTGART");
    expect(detail.body.capabilities).toHaveLength(2);
    const org = await ctx.prisma.organization.findUniqueOrThrow({ where: { id: res.body.organizationId } });
    expect(org.type).toBe("SUPPLIER");
    const audit = await ctx.prisma.auditEvent.findFirst({ where: { entityId: res.body.id, eventType: "supplier.created" } });
    expect(audit?.actorUserId).toBe(team.sourcing.id);
  });

  it("enforces role-based authorization", async () => {
    expect((await team.readOnly.session.post("/suppliers", { name: "Nope Inc", country: "US" })).status).toBe(403);
    const list = expectStatus(await team.readOnly.session.get("/suppliers?pageSize=5"), 200);
    expect(list.body).toHaveProperty("total");
  });

  it("updates with optimistic concurrency and audits controlled field changes", async () => {
    const s = expectStatus(await team.sourcing.session.post("/suppliers", { name: `Cast Works ${uniq()}`, country: "MX" }), 201).body;
    const ok = expectStatus(await team.sourcing.session.patch(`/suppliers/${s.id}`, { expectedVersion: s.version, legalName: "Cast Works SA de CV" }), 200);
    expect(ok.body.version).toBe(s.version + 1);
    const stale = await team.sourcing.session.patch(`/suppliers/${s.id}`, { expectedVersion: s.version, legalName: "Stale" });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("STALE_VERSION");
    const audit = await ctx.prisma.auditEvent.findFirst({ where: { entityId: s.id, eventType: "supplier.updated" } });
    expect(audit?.changes).toEqual({ legalName: { before: null, after: "Cast Works SA de CV" } });
  });

  it("cannot be approved by changing the status field; approval requires a qualification workflow", async () => {
    const s = expectStatus(await team.sourcing.session.post("/suppliers", { name: `Injector Tech ${uniq()}`, country: "US" }), 201).body;
    const direct = await team.quality.session.post(`/suppliers/${s.id}/status`, { status: "APPROVED", reason: "Trying to bypass" });
    expect(direct.status).toBe(400);
    const patch = await team.quality.session.patch(`/suppliers/${s.id}`, { expectedVersion: s.version, status: "APPROVED" });
    expect(patch.status).toBe(400);

    const q = expectStatus(
      await team.quality.session.post(`/suppliers/${s.id}/qualifications`, { type: "INITIAL", proposedStatus: "APPROVED", summary: "Desk audit and SQQ review complete", auditScore: 92 }),
      201,
    ).body;
    expectStatus(await team.quality.session.post(`/supplier-qualifications/${q.id}/submit`, { expectedVersion: q.version }), 201);
    expect((await ctx.prisma.supplier.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("UNDER_EVALUATION");

    // Step 1: Supplier Quality (not the submitter)
    const inboxQ2 = expectStatus(await team.quality2.session.get("/approvals/inbox"), 200).body;
    const a1 = inboxQ2.find((i: { subjectId: string }) => i.subjectId === q.id);
    expect(a1.canDecide).toBe(true);
    const inboxQ1 = expectStatus(await team.quality.session.get("/approvals/inbox"), 200).body;
    const own = inboxQ1.find((i: { subjectId: string }) => i.subjectId === q.id);
    expect(own.canDecide).toBe(false);
    expect((await team.quality.session.post(`/approvals/${own.id}/decision`, { decision: "APPROVE" })).status).toBe(403);
    expectStatus(await team.quality2.session.post(`/approvals/${a1.id}/decision`, { decision: "APPROVE", comment: "Recommended" }), 201);
    expect((await ctx.prisma.supplier.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("UNDER_EVALUATION");

    // Step 2: Management
    const a2 = expectStatus(await team.manager.session.get("/approvals/inbox"), 200).body.find((i: { subjectId: string }) => i.subjectId === q.id);
    expectStatus(await team.manager.session.post(`/approvals/${a2.id}/decision`, { decision: "APPROVE" }), 201);
    const supplier = await ctx.prisma.supplier.findUniqueOrThrow({ where: { id: s.id } });
    expect(supplier.status).toBe("APPROVED");
    const qual = await ctx.prisma.supplierQualification.findUniqueOrThrow({ where: { id: q.id } });
    expect(qual.status).toBe("APPROVED");
    const history = expectStatus(await team.readOnly.session.get(`/approvals/history?subjectType=SUPPLIER_QUALIFICATION&subjectId=${q.id}`), 200).body;
    expect(history[0].status).toBe("APPROVED");
    const decisions = history[0].steps.flatMap((st: { assignments: { decidedBy: { id: string } | null; status: string }[] }) => st.assignments.filter((a) => a.status === "APPROVED").map((a) => a.decidedBy!.id));
    expect(decisions).toEqual([team.quality2.id, team.manager.id]);
    const audit = await ctx.prisma.auditEvent.findFirst({ where: { entityId: s.id, eventType: "supplier.qualified" } });
    expect(audit?.changes).toEqual({ status: { before: "UNDER_EVALUATION", after: "APPROVED" } });
  });

  it("requires a comment to reject and records rejection", async () => {
    const s = expectStatus(await team.sourcing.session.post("/suppliers", { name: `Reject Me ${uniq()}`, country: "CN" }), 201).body;
    const q = expectStatus(await team.quality.session.post(`/suppliers/${s.id}/qualifications`, { type: "INITIAL", proposedStatus: "APPROVED", summary: "Assessment" }), 201).body;
    expectStatus(await team.quality.session.post(`/supplier-qualifications/${q.id}/submit`, { expectedVersion: q.version }), 201);
    const a = expectStatus(await team.quality2.session.get("/approvals/inbox"), 200).body.find((i: { subjectId: string }) => i.subjectId === q.id);
    expect((await team.quality2.session.post(`/approvals/${a.id}/decision`, { decision: "REJECT" })).status).toBe(422);
    expectStatus(await team.quality2.session.post(`/approvals/${a.id}/decision`, { decision: "REJECT", comment: "Capability gaps in heat treatment" }), 201);
    expect((await ctx.prisma.supplierQualification.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("REJECTED");
    expect((await team.quality2.session.post(`/approvals/${a.id}/decision`, { decision: "APPROVE" })).status).toBe(409);
  });

  it("manages contacts, sites and certifications and suspends with a reason", async () => {
    const s = expectStatus(await team.sourcing.session.post("/suppliers", { name: `Head Masters ${uniq()}`, country: "IN" }), 201).body;
    const site = expectStatus(await team.sourcing.session.post(`/suppliers/${s.id}/sites`, { siteCode: "PUNE", name: "Pune Works", city: "Pune", country: "IN" }), 201).body;
    expectStatus(await team.sourcing.session.post(`/suppliers/${s.id}/contacts`, { name: "R. Kumar", siteId: site.id, isPrimary: true }), 201);
    const cert = expectStatus(await team.sourcing.session.post(`/suppliers/${s.id}/certifications`, { standard: "IATF 16949", expiresAt: "2027-03-31", siteId: site.id }), 201).body;
    expect(cert.expiresAt.slice(0, 10)).toBe("2027-03-31");
    expect((await team.sourcing.session.post(`/suppliers/${s.id}/certifications`, { standard: "ISO 9001", expiresAt: "2027-02-30" })).status).toBe(422);
    const susp = expectStatus(await team.quality.session.post(`/suppliers/${s.id}/status`, { status: "SUSPENDED", reason: "Repeated quality escapes" }), 201);
    expect(susp.body.status).toBe("SUSPENDED");
    const certs = expectStatus(await team.readOnly.session.get(`/suppliers/${s.id}/certifications`), 200).body;
    expect(certs).toHaveLength(1);
  });

  it("filters and exports the directory as CSV", async () => {
    const name = `Export Co ${uniq()}`;
    expectStatus(await team.sourcing.session.post("/suppliers", { name, country: "JP" }), 201);
    const list = expectStatus(await team.readOnly.session.get(`/suppliers?q=${encodeURIComponent(name)}&status=PROSPECTIVE`), 200).body;
    expect(list.total).toBe(1);
    expect((await team.readOnly.session.get("/suppliers/export.csv")).status).toBe(403);
    const csv = await team.quality.session.get(`/suppliers/export.csv?q=${encodeURIComponent(name)}`);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.text).toContain(name);
  });
});
