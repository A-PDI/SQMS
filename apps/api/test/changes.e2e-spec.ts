import { approvedProduct, createApprovedSupplier, decideAll, fulfillRequirement, recordValidation } from "./flows";
import { createTeam, expectStatus, startApp, uniq, type Team, type TestContext } from "./helpers";

describe("Supplier change control", () => {
  let ctx: TestContext;
  let team: Team;

  beforeAll(async () => {
    ctx = await startApp();
    team = await createTeam(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  const approval = (revisionId: string) => ctx.prisma.productApproval.findUniqueOrThrow({ where: { configurationRevisionId: revisionId } });
  const cr = (id: string) => ctx.prisma.changeRequest.findUniqueOrThrow({ where: { id } });
  const baseCr = (supplierProductId: string, extra: Record<string, unknown> = {}) => ({
    supplierProductId,
    title: "Change turbine housing coating supplier",
    categories: ["COATING", "SUB_TIER"],
    reason: "Current coating sub-tier is closing its plant",
    description: "Move thermal barrier coating to an alternate qualified sub-tier with equivalent process",
    proposedImplementationDate: "2026-12-01",
    ...extra,
  });

  async function assessAndDecide(id: string, flags: Record<string, boolean>, riskLevel: string) {
    expectStatus(await team.engineer.session.post(`/change-requests/${id}/impact-assessments`, { discipline: "ENGINEERING", impactSummary: "Coating process change affects thermal performance", recommendation: "APPROVE_WITH_CONDITIONS", ...flags }), 201);
    expectStatus(await team.quality.session.post(`/change-requests/${id}/impact-assessments`, { discipline: "QUALITY", impactSummary: "Sub-tier change requires FAI", recommendation: "APPROVE" }), 201);
    const c = await cr(id);
    return expectStatus(await team.quality.session.post(`/change-requests/${id}/requalification-decision`, { expectedVersion: c.version, riskLevel }), 201).body;
  }

  it("creates a change request with a proposed revision distinct from the authorized configuration", async () => {
    const p = await approvedProduct(ctx, team, { pathway: "B" });
    const q = await ctx.prisma.productQualification.findUniqueOrThrow({ where: { id: p.qualificationId } });
    const created = expectStatus(await team.sourcing.session.post("/change-requests", baseCr(q.supplierProductId)), 201).body;
    expect(created.number).toMatch(/^SCR-\d{4}-\d{4}$/);
    expect(created.status).toBe("DRAFT");
    expect(created.currentRevisionId).toBe(p.revisionId);
    expect(created.proposedRevisionId).not.toBe(p.revisionId);
    const proposed = await ctx.prisma.configurationRevision.findUniqueOrThrow({ where: { id: created.proposedRevisionId }, include: { baseline: true } });
    expect(proposed.status).toBe("PROPOSED");
    expect(proposed.derivedFromRevisionId).toBe(p.revisionId);
    expect(proposed.revisionLabel).toBe("B");

    // Only one open change per authorized configuration.
    const dup = await team.sourcing.session.post("/change-requests", baseCr(q.supplierProductId));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("CHANGE_IN_PROGRESS");

    // The authorized revision is controlled; the proposed revision is edited instead.
    const current = await ctx.prisma.configurationRevision.findUniqueOrThrow({ where: { id: p.revisionId } });
    const locked = await team.engineer.session.put(`/product-configurations/revisions/${p.revisionId}/baseline`, { expectedVersion: current.version, coating: "Changed directly" });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe("CONTROLLED_RECORD");
    expectStatus(await team.engineer.session.put(`/product-configurations/revisions/${proposed.id}/baseline`, { expectedVersion: proposed.version, coating: "Thermal barrier coating, alternate sub-tier ACME Coat" }), 200);
    const edited = await ctx.prisma.engineeringBaseline.findUniqueOrThrow({ where: { configurationRevisionId: proposed.id } });
    expect(edited.status).not.toBe("ACCEPTED");

    const detail = expectStatus(await team.readOnly.session.get(`/change-requests/${created.id}`), 200).body;
    expect(detail.categories.sort()).toEqual(["COATING", "SUB_TIER"]);
    expect(detail.comparison.baseline).toEqual(expect.arrayContaining([expect.objectContaining({ field: "coating", proposed: "Thermal barrier coating, alternate sub-tier ACME Coat" })]));
    expect(detail.comparison.siteChanged).toBe(false);

    // A product without an approval cannot be changed through change control.
    const { supplier, site } = await createApprovedSupplier(ctx, team);
    const { internalPartId } = await ctx.prisma.supplierProduct.findUniqueOrThrow({ where: { id: q.supplierProductId } });
    const part = await ctx.prisma.supplierPart.create({ data: { supplierId: supplier.id, supplierPartNumber: uniq("SP-").toUpperCase(), description: "Unapproved" } });
    const sp = await ctx.prisma.supplierProduct.create({ data: { internalPartId, supplierId: supplier.id, supplierPartId: part.id, siteId: site.id } });
    expect((await team.sourcing.session.post("/change-requests", baseCr(sp.id))).status).toBe(422);
  });

  it("requalifies and approves a change while preserving the previously approved configuration", async () => {
    const p = await approvedProduct(ctx, team, { pathway: "B" });
    const q = await ctx.prisma.productQualification.findUniqueOrThrow({ where: { id: p.qualificationId } });
    const previousApproval = await approval(p.revisionId);
    const previousBaseline = await ctx.prisma.engineeringBaseline.findUniqueOrThrow({ where: { configurationRevisionId: p.revisionId } });
    const created = expectStatus(await team.sourcing.session.post("/change-requests", baseCr(q.supplierProductId)), 201).body;
    expectStatus(await team.sourcing.session.post(`/change-requests/${created.id}/submit`, { expectedVersion: created.version }), 201);

    // Requalification decision needs both engineering and quality assessments.
    expectStatus(await team.engineer.session.post(`/change-requests/${created.id}/impact-assessments`, { discipline: "ENGINEERING", impactSummary: "Thermal performance may change", recommendation: "APPROVE", requiresFai: true, requiresFunctionalTest: true, requiresMaterialCertificates: true }), 201);
    const early = await team.quality.session.post(`/change-requests/${created.id}/requalification-decision`, { expectedVersion: (await cr(created.id)).version, riskLevel: "MEDIUM" });
    expect(early.status).toBe(422);
    expect((await team.readOnly.session.post(`/change-requests/${created.id}/impact-assessments`, { discipline: "QUALITY", impactSummary: "Not allowed", recommendation: "APPROVE" })).status).toBe(403);
    const decision = await assessAndDecide(created.id, { requiresFai: true, requiresFunctionalTest: true, requiresMaterialCertificates: true }, "MEDIUM");
    expect(decision.status).toBe("VALIDATION_REQUIRED");
    expect(decision.requiredDocuments.sort()).toEqual(["VAL-02", "VAL-03", "VAL-04"]);
    const requal = await ctx.prisma.productQualification.findUniqueOrThrow({ where: { id: decision.qualificationId } });
    expect(requal.changeRequestId).toBe(created.id);
    expect(requal.configurationRevisionId).toBe(created.proposedRevisionId);

    // Approval is blocked until the requalification evidence is complete.
    const blocked = await team.quality.session.post(`/change-requests/${created.id}/submit-for-approval`, { expectedVersion: (await cr(created.id)).version });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe("APPROVAL_GATE_FAILED");
    // Requalification of a change is approved only through the change workflow.
    expect((await team.quality.session.post(`/qualifications/${requal.id}/submit`, { expectedVersion: requal.version })).status).toBe(422);

    for (const r of await ctx.prisma.requiredDocument.findMany({ where: { changeRequestId: created.id } })) await fulfillRequirement(ctx, team, r.id);
    await recordValidation(team, requal.id);
    const detail = expectStatus(await team.quality.session.get(`/change-requests/${created.id}`), 200).body;
    expect(detail.gate.filter((g: { passed: boolean }) => !g.passed)).toEqual([]);
    expect(detail.impactAssessments).toHaveLength(2);

    expectStatus(await team.quality.session.post(`/change-requests/${created.id}/submit-for-approval`, { expectedVersion: (await cr(created.id)).version, dispositionConditions: "First 3 lots require 100% coating thickness inspection" }), 201);
    expect((await ctx.prisma.configurationRevision.findUniqueOrThrow({ where: { id: created.proposedRevisionId } })).status).toBe("IN_REVIEW");
    // Edits are blocked while under approval.
    expect((await team.engineer.session.post(`/change-requests/${created.id}/impact-assessments`, { discipline: "MANUFACTURING", impactSummary: "Too late to assess", recommendation: "APPROVE" })).status).toBe(409);
    await decideAll(ctx, team, created.id);

    const approved = await cr(created.id);
    expect(approved.status).toBe("APPROVED");
    expect(approved.disposition).toBe("APPROVED_WITH_CONDITIONS");
    expect(approved.shipmentAuthorizedAt).toBeNull();
    const proposed = await ctx.prisma.configurationRevision.findUniqueOrThrow({ where: { id: created.proposedRevisionId }, include: { configuration: true } });
    expect(proposed.status).toBe("APPROVED");
    expect(proposed.configuration.currentApprovedRevisionId).toBe(proposed.id);
    // Previous configuration preserved: superseded, not overwritten.
    const previous = await ctx.prisma.configurationRevision.findUniqueOrThrow({ where: { id: p.revisionId }, include: { baseline: true } });
    expect(previous.status).toBe("SUPERSEDED");
    expect(previous.supersededByRevisionId).toBe(proposed.id);
    expect(previous.baseline?.coating).toBe(previousBaseline.coating);
    const prevApproval = await ctx.prisma.productApproval.findUniqueOrThrow({ where: { id: previousApproval.id } });
    expect(prevApproval.status).toBe("SUPERSEDED");
    expect(prevApproval.supersededByChangeRequestId).toBe(created.id);
    const newApproval = await approval(proposed.id);
    expect(newApproval.status).toBe("ACTIVE");
    expect(newApproval.restrictions).toMatch(/coating thickness/);
    expect((await ctx.prisma.supplierProduct.findUniqueOrThrow({ where: { id: q.supplierProductId } })).status).toBe("CONDITIONALLY_APPROVED");

    // Shipment is authorized only after implementation verification.
    expect((await team.quality.session.post(`/change-requests/${created.id}/close`, { expectedVersion: approved.version })).status).toBe(409);
    const verified = expectStatus(await team.quality.session.post(`/change-requests/${created.id}/verify-implementation`, { expectedVersion: approved.version, implementationNotes: "First lot coating micrographs reviewed" }), 201).body;
    expect(verified.status).toBe("IMPLEMENTATION_VERIFIED");
    expect(verified.shipmentAuthorizedAt).toBeTruthy();
    expect(expectStatus(await team.quality.session.post(`/change-requests/${created.id}/close`, { expectedVersion: verified.version }), 201).body.status).toBe("CLOSED");
    expect(await ctx.prisma.auditEvent.count({ where: { entityId: created.id, eventType: { in: ["change_request.approved", "change_request.implementation_verified", "change_request.closed"] } } })).toBe(3);
  });

  it("keeps the approved configuration in effect when a change is rejected", async () => {
    const p = await approvedProduct(ctx, team, { pathway: "B" });
    const q = await ctx.prisma.productQualification.findUniqueOrThrow({ where: { id: p.qualificationId } });
    const created = expectStatus(await team.sourcing.session.post("/change-requests", baseCr(q.supplierProductId, { categories: ["INSPECTION_METHOD"], title: "Replace CMM inspection with gauge" })), 201).body;
    expectStatus(await team.sourcing.session.post(`/change-requests/${created.id}/submit`, { expectedVersion: created.version }), 201);

    // Information request and resubmission.
    let c = await cr(created.id);
    expectStatus(await team.quality.session.post(`/change-requests/${created.id}/request-information`, { expectedVersion: c.version, reason: "Provide gauge R&R results" }), 201);
    c = await cr(created.id);
    expect(c.status).toBe("INFO_REQUIRED");
    expect(c.infoRequest).toBe("Provide gauge R&R results");
    expectStatus(await team.sourcing.session.patch(`/change-requests/${created.id}`, { expectedVersion: c.version, description: "Gauge R&R 8% attached to the supplier submission" }), 200);
    c = await cr(created.id);
    expectStatus(await team.sourcing.session.post(`/change-requests/${created.id}/submit`, { expectedVersion: c.version }), 201);

    const d = await assessAndDecide(created.id, {}, "LOW");
    expect(d.status).toBe("UNDER_REVIEW");
    expectStatus(await team.quality.session.post(`/change-requests/${created.id}/submit-for-approval`, { expectedVersion: (await cr(created.id)).version }), 201);
    const inbox = (expectStatus(await team.engineer.session.get("/approvals/inbox"), 200).body as { id: string; subjectId: string; canDecide: boolean }[]).find((i) => i.subjectId === created.id && i.canDecide)!;
    expect((await team.engineer.session.post(`/approvals/${inbox.id}/decision`, { decision: "REJECT" })).status).toBe(422);
    expectStatus(await team.engineer.session.post(`/approvals/${inbox.id}/decision`, { decision: "REJECT", comment: "Gauge cannot measure the critical bore runout" }), 201);

    const rejected = await cr(created.id);
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.disposition).toBe("REJECTED");
    expect((await ctx.prisma.configurationRevision.findUniqueOrThrow({ where: { id: created.proposedRevisionId } })).status).toBe("REJECTED");
    const current = await ctx.prisma.configurationRevision.findUniqueOrThrow({ where: { id: p.revisionId }, include: { configuration: true } });
    expect(current.status).toBe("APPROVED");
    expect(current.configuration.currentApprovedRevisionId).toBe(p.revisionId);
    expect((await approval(p.revisionId)).status).toBe("ACTIVE");
    expect((await ctx.prisma.productQualification.findFirstOrThrow({ where: { changeRequestId: created.id } })).status).toBe("REJECTED");
    // A new change can be raised once the previous one is decided.
    expectStatus(await team.sourcing.session.post("/change-requests", baseCr(q.supplierProductId)), 201);
  });

  it("transfers the approval to a new site on an approved location change", async () => {
    const p = await approvedProduct(ctx, team, { pathway: "B" });
    const q = await ctx.prisma.productQualification.findUniqueOrThrow({ where: { id: p.qualificationId }, include: { supplierProduct: true } });
    const site2 = expectStatus(await team.quality.session.post(`/suppliers/${p.supplierId}/sites`, { siteCode: "PLANT2", name: "Second Plant", city: "Monterrey", country: "MX" }), 201).body;
    expect((await team.sourcing.session.post("/change-requests", baseCr(q.supplierProductId, { categories: ["LOCATION"] }))).status).toBe(422);
    const created = expectStatus(await team.sourcing.session.post("/change-requests", baseCr(q.supplierProductId, { categories: ["LOCATION"], title: "Relocate production to Monterrey", proposedSiteId: site2.id })), 201).body;
    const proposed = await ctx.prisma.configurationRevision.findUniqueOrThrow({ where: { id: created.proposedRevisionId }, include: { configuration: { include: { supplierProduct: true } } } });
    expect(proposed.configuration.supplierProduct.siteId).toBe(site2.id);
    expect(proposed.configuration.id).not.toBe(q.supplierProduct.id);
    expect(expectStatus(await team.readOnly.session.get(`/change-requests/${created.id}`), 200).body.comparison.siteChanged).toBe(true);

    expectStatus(await team.sourcing.session.post(`/change-requests/${created.id}/submit`, { expectedVersion: created.version }), 201);
    const d = await assessAndDecide(created.id, {}, "HIGH");
    expect(d.requiredDocuments).toEqual(["VAL-02"]);
    for (const r of await ctx.prisma.requiredDocument.findMany({ where: { changeRequestId: created.id } })) await fulfillRequirement(ctx, team, r.id);
    await recordValidation(team, d.qualificationId);
    expectStatus(await team.quality.session.post(`/change-requests/${created.id}/submit-for-approval`, { expectedVersion: (await cr(created.id)).version }), 201);
    // HIGH risk adds the management approval step.
    await decideAll(ctx, team, created.id);
    const steps = await ctx.prisma.workflowStep.findMany({ where: { instance: { subjectId: created.id } }, include: { stepDefinition: true } });
    expect(steps.find((s) => s.stepDefinition.key === "mgmt-approval")?.status).toBe("APPROVED");

    expect((await cr(created.id)).status).toBe("APPROVED");
    const newSp = await ctx.prisma.supplierProduct.findUniqueOrThrow({ where: { id: proposed.configuration.supplierProductId } });
    expect(newSp.status).toBe("APPROVED");
    expect((await approval(proposed.id)).siteId).toBe(site2.id);
    expect((await approval(p.revisionId)).status).toBe("SUPERSEDED");
    expect((await ctx.prisma.supplierProduct.findUniqueOrThrow({ where: { id: q.supplierProductId } })).status).toBe("INACTIVE");
    expect((await ctx.prisma.configurationRevision.findUniqueOrThrow({ where: { id: p.revisionId } })).status).toBe("SUPERSEDED");
  });

  it("withdraws a change request and releases the configuration for a new change", async () => {
    const p = await approvedProduct(ctx, team, { pathway: "B" });
    const q = await ctx.prisma.productQualification.findUniqueOrThrow({ where: { id: p.qualificationId } });
    const created = expectStatus(await team.sourcing.session.post("/change-requests", baseCr(q.supplierProductId)), 201).body;
    expect((await team.sourcing.session.post(`/change-requests/${created.id}/withdraw`, { expectedVersion: created.version, reason: "no" })).status).toBe(400);
    expectStatus(await team.sourcing.session.post(`/change-requests/${created.id}/withdraw`, { expectedVersion: created.version, reason: "Supplier cancelled the change" }), 201);
    expect((await cr(created.id)).status).toBe("WITHDRAWN");
    expect((await ctx.prisma.configurationRevision.findUniqueOrThrow({ where: { id: created.proposedRevisionId } })).status).toBe("WITHDRAWN");
    expect((await approval(p.revisionId)).status).toBe("ACTIVE");
    expectStatus(await team.sourcing.session.post("/change-requests", baseCr(q.supplierProductId)), 201);
    const csv = await team.quality.session.get("/change-requests/export.csv");
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.text).toContain(created.number);
  });
});
