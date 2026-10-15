import { acceptBaselineAndDelta, approveIntake, completeChecklist, createApprovedSupplier, createProject, decideAll, LOW_RISK, recordValidation } from "./flows";
import { createTeam, expectStatus, startApp, type Team, type TestContext } from "./helpers";

type Req = { id: string; level: string; status: string; documentType: { code: string } };

describe("Sourcing projects, checklists and product approval", () => {
  let ctx: TestContext;
  let team: Team;
  let supplier: { id: string };
  let site: { id: string };

  beforeAll(async () => {
    ctx = await startApp();
    team = await createTeam(ctx);
    ({ supplier, site } = await createApprovedSupplier(ctx, team));
  });
  afterAll(async () => {
    await ctx.close();
  });

  const project = async (id: string) => expectStatus(await team.readOnly.session.get(`/sourcing-projects/${id}`), 200).body;
  const levels = (reqs: Req[]) => Object.fromEntries(reqs.filter((r) => r.status !== "NOT_APPLICABLE").map((r) => [r.documentType.code, r.level]));

  it("creates Path A, B and C projects with pathway-specific configurations and checklists", async () => {
    const a = await createProject(ctx, team, { pathway: "A", supplierId: supplier.id, siteId: site.id });
    const pa = await project(a.id);
    expect(pa.engineeringOwnership).toBe("COMPANY");
    expect(pa.configuration.configurationType).toBe("CUSTOMER_DESIGN");
    expect(pa.configuration.revisions[0].baseline.baselineType).toBe("CUSTOMER_CONTROLLED_DESIGN");
    expect(pa.policyVersion.version).toBeGreaterThanOrEqual(1);
    const la = levels(pa.requirements);
    expect(la["ENG-01"]).toBe("REQUIRED");
    expect(la["SUP-04"]).toBe("REQUIRED");
    expect(la["VAL-02"]).toBe("REQUIRED");
    expect(la["ENG-04"]).toBeUndefined();
    expect(la["ENG-06"]).toBeUndefined();
    // Intake records are created natively and linked to their checklist items.
    const intake = pa.requirements.filter((r: Req & { documentId: string | null }) => ["INT-01", "INT-02"].includes(r.documentType.code));
    expect(intake).toHaveLength(2);
    expect(intake.every((r: { documentId: string | null }) => !!r.documentId)).toBe(true);

    const b = await createProject(ctx, team, { pathway: "B", supplierId: supplier.id, siteId: site.id });
    const pb = await project(b.id);
    expect(pb.engineeringOwnership).toBe("SUPPLIER");
    expect(pb.configuration.configurationType).toBe("SUPPLIER_STANDARD");
    expect(pb.configuration.revisions[0].baseline.baselineType).toBe("SUPPLIER_PRODUCT_BASELINE");
    const lb = levels(pb.requirements);
    expect(lb["ENG-04"]).toBe("REQUIRED");
    expect(lb["ENG-05"]).toBe("REQUIRED");
    expect(lb["ENG-01"]).toBeUndefined();
    expect(lb["SUP-04"]).toBe("CONDITIONAL");

    const c = await createProject(ctx, team, { pathway: "C", supplierId: supplier.id, siteId: site.id });
    const pc = await project(c.id);
    expect(pc.engineeringOwnership).toBe("SHARED");
    expect(pc.configuration.configurationType).toBe("SUPPLIER_MODIFIED");
    expect(pc.configuration.baseConfigurationId).toBeTruthy();
    expect(pc.supplierPart.isCustom).toBe(true);
    const base = await ctx.prisma.productConfiguration.findUniqueOrThrow({ where: { id: pc.configuration.baseConfigurationId }, include: { revisions: { include: { baseline: true } } } });
    expect(base.configurationType).toBe("SUPPLIER_STANDARD");
    expect(base.revisions[0].baseline?.baselineType).toBe("SUPPLIER_PRODUCT_BASELINE");
    const customRev = await ctx.prisma.configurationRevision.findFirstOrThrow({ where: { configurationId: c.configurationId }, include: { baseline: true, requirements: true } });
    expect(customRev.baseline?.baselineType).toBe("SUPPLIER_BASELINE_WITH_DELTA");
    expect(customRev.requirements).toHaveLength(1);
    expect(customRev.requirements[0].category).toBe("COATING");
    const lc = levels(pc.requirements);
    for (const code of ["ENG-04", "ENG-05", "ENG-06", "ENG-07", "VAL-02", "VAL-03", "SUP-04"]) expect(lc[code]).toBe("REQUIRED");

    // Risk and policy version are recorded with the checklist.
    const generated = await ctx.prisma.auditEvent.findFirstOrThrow({ where: { entityId: c.id, eventType: "checklist.generated" } });
    expect((generated.metadata as { policyVersion: number }).policyVersion).toBe(pc.policyVersion.version);
    expect(pc.risk.modelVersion).toBeTruthy();
    expect(pc.risk.score).toBeGreaterThan(0);
  });

  it("supports the reverse-engineering stage on Pathway A only", async () => {
    const r = await createProject(ctx, team, { pathway: "A", reverseEngineering: true, supplierId: supplier.id, siteId: site.id });
    const p = await project(r.id);
    expect(p.configuration.revisions[0].baseline.baselineType).toBe("PRELIMINARY_REVERSE_ENGINEERED");
    const l = levels(p.requirements);
    expect(l["ENG-03"]).toBe("REQUIRED");
    expect(l["ENG-02"]).toBe("REQUIRED");
    expect(l["ENG-04"]).toBe("REQUIRED");
    expect(l["ENG-01"]).toBeUndefined();
    await approveIntake(ctx, team, r.id);
    expect((await project(r.id)).stage).toBe("REVERSE_ENGINEERING");

    // The preliminary definition cannot be accepted before the reverse-engineering reviews are complete.
    const rev = await ctx.prisma.configurationRevision.findFirstOrThrow({ where: { configurationId: r.configurationId } });
    expectStatus(await team.engineer.session.put(`/product-configurations/revisions/${rev.id}/baseline`, { expectedVersion: rev.version, drawingNumber: "RE-DWG-1", drawingRevision: "P1", reverseEngineeringSource: "Physical sample S/N 001" }), 200);
    const fresh = await ctx.prisma.configurationRevision.findUniqueOrThrow({ where: { id: rev.id } });
    const blocked = await team.engineer.session.post(`/product-configurations/revisions/${rev.id}/baseline/accept`, { expectedVersion: fresh.version });
    expect(blocked.status).toBe(422);
    expect(JSON.stringify(blocked.body.error.details)).toMatch(/ENG-03/);

    const bad = await team.sourcing.session.post("/sourcing-projects", {
      title: "Invalid reverse engineering",
      businessJustification: "Testing validation",
      newPart: { partNumber: "RE-BAD-1", description: "Bad" },
      supplierId: supplier.id,
      siteId: site.id,
      pathway: "B",
      reverseEngineeringRequired: true,
      riskFactors: LOW_RISK,
      specialProcesses: false,
      customerRequirements: false,
    });
    expect(bad.status).toBe(422);
  });

  it("previews the generated checklist without persisting anything", async () => {
    const before = await ctx.prisma.sourcingProject.count();
    const res = expectStatus(
      await team.sourcing.session.post("/sourcing-projects/preview", { pathway: "C", supplierId: supplier.id, criticality: "HIGH", reverseEngineeringRequired: false, specialProcesses: true, customerRequirements: true, riskFactors: LOW_RISK }),
      201,
    ).body;
    expect(res.risk.level).toBeTruthy();
    const codes = Object.fromEntries(res.requirements.map((r: { documentTypeCode: string; level: string }) => [r.documentTypeCode, r.level]));
    expect(codes["SUP-05"]).toBe("REQUIRED");
    expect(codes["VAL-04"]).toBe("REQUIRED");
    expect(codes["ENG-08"]).toBe("REQUIRED");
    expect(res.requirements[0].documentType.name).toBeTruthy();
    expect(await ctx.prisma.sourcingProject.count()).toBe(before);
    const invalid = await team.sourcing.session.post("/sourcing-projects/preview", { pathway: "B", reverseEngineeringRequired: false, specialProcesses: false, customerRequirements: false, riskFactors: { manufacturingComplexity: "EXTREME" } });
    expect(invalid.status).toBe(422);
  });

  it("requires the right authority to waive conditional and mandatory requirements", async () => {
    const b = await createProject(ctx, team, { pathway: "B", supplierId: supplier.id, siteId: site.id });
    const reqs = (await project(b.id)).requirements as Req[];
    const mandatory = reqs.find((r) => r.documentType.code === "ENG-04")!;
    const conditional = reqs.find((r) => r.documentType.code === "SUP-04")!;
    const conditional2 = reqs.find((r) => r.documentType.code === "OPS-01")!;
    expect(mandatory.level).toBe("REQUIRED");
    expect(conditional.level).toBe("CONDITIONAL");

    const justification = "Supplier standard catalogue item; covered by existing agreement";
    // Sourcing has no waiver authority at all; engineering may only waive conditional items.
    expect((await team.sourcing.session.post(`/required-documents/${conditional.id}/waive`, { justification })).status).toBe(403);
    expect((await team.readOnly.session.post(`/required-documents/${conditional.id}/waive`, { justification })).status).toBe(403);
    const denied = await team.engineer.session.post(`/required-documents/${mandatory.id}/waive`, { justification });
    expect(denied.status).toBe(403);
    expect(await ctx.prisma.auditEvent.count({ where: { entityId: mandatory.id, eventType: "requirement.waive_denied", outcome: "DENIED" } })).toBe(1);
    expect((await team.engineer.session.post(`/required-documents/${conditional.id}/waive`, { justification: "short" })).status).toBe(400);
    expectStatus(await team.engineer.session.post(`/required-documents/${conditional.id}/waive`, { justification }), 201);
    // Supplier Quality holds mandatory waiver authority.
    const waived = expectStatus(await team.quality.session.post(`/required-documents/${mandatory.id}/waive`, { justification }), 201).body;
    expect(waived.status).toBe("WAIVED");
    expect(waived.waiverJustification).toBe(justification);
    expect(waived.waivedById).toBe(team.quality.id);
    const audit = await ctx.prisma.auditEvent.findFirstOrThrow({ where: { entityId: mandatory.id, eventType: "requirement.waived" } });
    expect(audit.reason).toBe(justification);
    expect(audit.actorUserId).toBe(team.quality.id);
    // A waived item cannot be waived twice; it can be reinstated.
    expect((await team.quality.session.post(`/required-documents/${mandatory.id}/waive`, { justification })).status).toBe(409);
    expect(expectStatus(await team.quality.session.post(`/required-documents/${mandatory.id}/reinstate`), 201).body.status).toBe("OPEN");
    void conditional2;
  });

  it("runs intake review and creates document tasks for open requirements", async () => {
    const b = await createProject(ctx, team, { pathway: "B", supplierId: supplier.id, siteId: site.id });
    const p = await ctx.prisma.sourcingProject.findUniqueOrThrow({ where: { id: b.id } });
    expect((await team.sourcing.session.post(`/sourcing-projects/${b.id}/submit`, { expectedVersion: p.version + 5 })).status).toBe(409);
    expectStatus(await team.sourcing.session.post(`/sourcing-projects/${b.id}/submit`, { expectedVersion: p.version }), 201);
    const submitted = await project(b.id);
    expect(submitted.status).toBe("SUBMITTED");
    const intake = (submitted.requirements as Req[]).filter((r) => ["INT-01", "INT-02"].includes(r.documentType.code));
    expect(intake.map((r) => r.status)).toEqual(["SUBMITTED", "SUBMITTED"]);
    // Submitter (sourcing) is not an approver; engineering and supplier quality decide in parallel.
    expect(((await team.sourcing.session.get("/approvals/inbox")).body as { subjectId: string; canDecide: boolean }[]).some((i) => i.subjectId === b.id && i.canDecide)).toBe(false);
    await decideAll(ctx, team, b.id);
    const approved = await project(b.id);
    expect(approved.status).toBe("IN_PROGRESS");
    expect(approved.stage).toBe("ENGINEERING_DEFINITION");
    const reqs = approved.requirements as Req[];
    expect(reqs.filter((r) => ["INT-01", "INT-02"].includes(r.documentType.code)).every((r) => r.status === "ACCEPTED")).toBe(true);
    const open = reqs.filter((r) => r.status === "OPEN");
    const tasks = await ctx.prisma.task.findMany({ where: { entityId: b.id, type: "DOCUMENT_SUBMISSION" } });
    expect(tasks).toHaveLength(open.length);
    expect(tasks.find((t) => t.requiredDocumentId === reqs.find((r) => r.documentType.code === "ENG-04")!.id)?.priority).toBe("HIGH");
    // Resubmission is not possible once in progress.
    const again = await team.sourcing.session.post(`/sourcing-projects/${b.id}/submit`, { expectedVersion: approved.version });
    expect(again.status).toBe(409);
  });

  it("blocks product approval while required evidence is missing", async () => {
    const b = await createProject(ctx, team, { pathway: "B", supplierId: supplier.id, siteId: site.id });
    await approveIntake(ctx, team, b.id);
    const q = expectStatus(await team.quality.session.post("/qualifications", { sourcingProjectId: b.id }), 201).body;
    expect((await project(b.id)).status).toBe("QUALIFICATION");
    expect((await team.quality.session.post("/qualifications", { sourcingProjectId: b.id })).status).toBe(409);

    const gate = expectStatus(await team.readOnly.session.get(`/qualifications/${q.id}/gate`), 200).body as { key: string; passed: boolean; details: string[] }[];
    expect(gate.find((c) => c.key === "baseline")!.passed).toBe(false);
    expect(gate.find((c) => c.key === "documentation")!.passed).toBe(false);
    expect(gate.find((c) => c.key === "documentation")!.details.join("\n")).toMatch(/ENG-04/);
    expect(gate.find((c) => c.key === "supplier")!.passed).toBe(true);

    const res = await team.quality.session.post(`/qualifications/${q.id}/submit`, { expectedVersion: q.version });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("APPROVAL_GATE_FAILED");
    const failing = (res.body.error.details.checks as { key: string }[]).map((c) => c.key);
    expect(failing).toEqual(expect.arrayContaining(["baseline", "documentation"]));
    const after = await ctx.prisma.productQualification.findUniqueOrThrow({ where: { id: q.id } });
    expect(after.status).toBe("DOCUMENTATION_PENDING");
    // Status cannot be forced to an approval state through the manual status endpoint.
    expect((await team.quality.session.post(`/qualifications/${q.id}/status`, { expectedVersion: after.version, status: "APPROVED" })).status).toBe(400);
    expect(await ctx.prisma.productApproval.count({ where: { qualificationId: q.id } })).toBe(0);

    // Evidence rules: a failed FAI cannot be accepted and a passing FAI cannot carry nonconformities.
    expect((await team.quality.session.post(`/qualifications/${q.id}/first-articles`, { characteristicsInspected: 10, nonconformingCount: 1, outcome: "PASS" })).status).toBe(422);
    const failed = expectStatus(await team.quality.session.post(`/qualifications/${q.id}/first-articles`, { characteristicsInspected: 10, nonconformingCount: 2, outcome: "FAIL" }), 201).body;
    expect((await team.quality2.session.post(`/qualifications/first-articles/${failed.id}/review`, { decision: "ACCEPTED", comment: "Try to accept" })).status).toBe(422);
  });

  it("approves a Path C custom configuration once every gate condition is met", async () => {
    const c = await createProject(ctx, team, { pathway: "C", supplierId: supplier.id, siteId: site.id });
    await approveIntake(ctx, team, c.id);
    await completeChecklist(ctx, team, c.id);
    const revisionId = await acceptBaselineAndDelta(ctx, team, c.configurationId);
    const q = expectStatus(await team.quality.session.post("/qualifications", { sourcingProjectId: c.id }), 201).body;
    await recordValidation(team, q.id);
    const gate = expectStatus(await team.readOnly.session.get(`/qualifications/${q.id}/gate`), 200).body as { key: string; passed: boolean }[];
    expect(gate.filter((g) => !g.passed)).toEqual([]);
    expect(gate.map((g) => g.key)).toContain("delta");
    const fresh = await ctx.prisma.productQualification.findUniqueOrThrow({ where: { id: q.id } });
    expectStatus(await team.quality.session.post(`/qualifications/${q.id}/submit`, { expectedVersion: fresh.version }), 201);
    expect((await ctx.prisma.configurationRevision.findUniqueOrThrow({ where: { id: revisionId } })).status).toBe("IN_REVIEW");
    // Controlled while under approval review.
    expect((await team.quality.session.post(`/qualifications/${q.id}/tests`, { testType: "PERFORMANCE", name: "Late test", acceptanceCriteria: "n/a criteria" })).status).toBe(409);
    await decideAll(ctx, team, q.id);

    const final = await ctx.prisma.productQualification.findUniqueOrThrow({ where: { id: q.id }, include: { productApproval: true, supplierProduct: true } });
    expect(final.status).toBe("APPROVED");
    expect(final.productApproval?.status).toBe("ACTIVE");
    expect(final.productApproval?.configurationRevisionId).toBe(revisionId);
    expect(final.productApproval?.siteId).toBe(site.id);
    expect(final.supplierProduct.status).toBe("APPROVED");
    const rev = await ctx.prisma.configurationRevision.findUniqueOrThrow({ where: { id: revisionId }, include: { configuration: true } });
    expect(rev.status).toBe("APPROVED");
    expect(rev.configuration.currentApprovedRevisionId).toBe(revisionId);
    // The original supplier configuration is retained and not approved by this decision.
    const base = await ctx.prisma.productConfiguration.findUniqueOrThrow({ where: { id: rev.configuration.baseConfigurationId! } });
    expect(base.currentApprovedRevisionId).toBeNull();
    const p = await project(c.id);
    expect(p.status).toBe("APPROVED");
    expect(p.stage).toBe("PRODUCTION");

    // Release snapshot of the exact revisions used, with integrity verification.
    const pkg = expectStatus(await team.readOnly.session.get(`/qualifications/${q.id}/approval-package`), 200).body;
    expect(pkg.integrityVerified).toBe(true);
    expect(pkg.items.length).toBeGreaterThan(3);
    expect(pkg.snapshot.configurationRevision.id).toBe(revisionId);
    expect(pkg.snapshot.configurationRevision.requirements[0].ackStatus).toBe("ACKNOWLEDGED");
    expect(pkg.snapshot.waivers.length).toBeGreaterThan(0);
    expect(pkg.snapshot.approvals.map((a: { decidedById: string }) => a.decidedById)).not.toContain(team.quality.id);
    // A tampered snapshot is detected.
    await ctx.prisma.approvalPackage.update({ where: { id: pkg.id }, data: { snapshot: { ...pkg.snapshot, approvedAt: "2000-01-01T00:00:00.000Z" } } });
    expect(expectStatus(await team.readOnly.session.get(`/qualifications/${q.id}/approval-package`), 200).body.integrityVerified).toBe(false);
    await ctx.prisma.approvalPackage.update({ where: { id: pkg.id }, data: { snapshot: pkg.snapshot } });

    // System-generated released PSAR (VAL-11).
    const psar = await ctx.prisma.documentRecord.findFirstOrThrow({ where: { documentType: { code: "VAL-11" }, links: { some: { entityType: "PRODUCT_QUALIFICATION", entityId: q.id } } }, include: { releasedRevision: true } });
    expect(psar.status).toBe("RELEASED");
    expect(psar.releasedRevision?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await ctx.prisma.auditEvent.count({ where: { entityId: q.id, eventType: "product.approved" } })).toBe(1);
    expect(await ctx.prisma.outboxEvent.count({ where: { eventType: "product.approved", aggregateId: final.supplierProductId } })).toBe(1);
  });

  it("re-checks the approval gate when the final approval is recorded", async () => {
    const b = await createProject(ctx, team, { pathway: "B", supplierId: supplier.id, siteId: site.id });
    await approveIntake(ctx, team, b.id);
    await completeChecklist(ctx, team, b.id);
    const revisionId = await acceptBaselineAndDelta(ctx, team, b.configurationId);
    const q = expectStatus(await team.quality.session.post("/qualifications", { sourcingProjectId: b.id }), 201).body;
    await recordValidation(team, q.id);
    const fresh = await ctx.prisma.productQualification.findUniqueOrThrow({ where: { id: q.id } });
    expectStatus(await team.quality.session.post(`/qualifications/${q.id}/submit`, { expectedVersion: fresh.version }), 201);

    // A blocking nonconformance is raised against the revision while approvals are in progress.
    const part = await ctx.prisma.supplierProduct.findUniqueOrThrow({ where: { id: fresh.supplierProductId } });
    const ncr = await ctx.prisma.nonconformance.create({
      data: { number: `NCR-T-${Date.now()}`, title: "Late finding", dateIdentified: new Date(), source: "QUALIFICATION", supplierId: supplier.id, internalPartId: part.internalPartId, configurationRevisionId: revisionId, quantityAffected: 1, defectDescription: "Porosity found", severity: "MAJOR", ownerId: team.quality.id, createdById: team.quality.id },
    });
    const inbox = async (s: typeof team.engineer.session) => ((await s.get("/approvals/inbox")).body as { id: string; subjectId: string; canDecide: boolean }[]).find((i) => i.subjectId === q.id && i.canDecide);
    const eng = await inbox(team.engineer.session);
    expectStatus(await team.engineer.session.post(`/approvals/${eng!.id}/decision`, { decision: "APPROVE", comment: "Engineering OK" }), 201);
    const sq = await inbox(team.quality2.session);
    const blocked = await team.quality2.session.post(`/approvals/${sq!.id}/decision`, { decision: "APPROVE", comment: "Quality OK" });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe("APPROVAL_GATE_FAILED");
    expect(JSON.stringify(blocked.body.error.details)).toContain(ncr.number);
    // The decision was rolled back with the failed finalization.
    expect((await ctx.prisma.approvalAssignment.findUniqueOrThrow({ where: { id: sq!.id } })).status).toBe("PENDING");
    expect((await ctx.prisma.productQualification.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("APPROVAL_REVIEW");
    expect(await ctx.prisma.productApproval.count({ where: { qualificationId: q.id } })).toBe(0);

    await ctx.prisma.nonconformance.update({ where: { id: ncr.id }, data: { status: "CLOSED", closedAt: new Date() } });
    expectStatus(await team.quality2.session.post(`/approvals/${sq!.id}/decision`, { decision: "APPROVE", comment: "Quality OK" }), 201);
    expect((await ctx.prisma.productQualification.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("APPROVED");
  });
});
