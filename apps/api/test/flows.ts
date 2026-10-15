/** Reusable end-to-end business flows for integration tests (all through the public API). */
import { PDF_BYTES } from "./fixtures";
import { expectStatus, uniq, waitFor, type Session, type Team, type TestContext } from "./helpers";

export const LOW_RISK = { manufacturingComplexity: "LOW", technologyNovelty: "ESTABLISHED", supplyChain: "LOW", singleSource: "false", regulatoryImpact: "false", fieldHistory: "NONE" };

export async function createApprovedSupplier(ctx: TestContext, team: Team, name = `Supplier ${uniq()}`) {
  const s = expectStatus(await team.sourcing.session.post("/suppliers", { name, country: "US", sites: [{ siteCode: "MAIN", name: "Main Plant", city: "Columbus", country: "US" }] }), 201).body;
  const q = expectStatus(await team.quality.session.post(`/suppliers/${s.id}/qualifications`, { type: "INITIAL", proposedStatus: "APPROVED", summary: "Qualified for test" }), 201).body;
  expectStatus(await team.quality.session.post(`/supplier-qualifications/${q.id}/submit`, { expectedVersion: q.version }), 201);
  await decideAll(ctx, team, q.id);
  const site = await ctx.prisma.supplierSite.findFirstOrThrow({ where: { supplierId: s.id } });
  return { supplier: s, site };
}

/** Approves every pending approval for a subject using the first eligible team member until none remain. */
export async function decideAll(ctx: TestContext, team: Team, subjectId: string, approvers: Session[] = [team.engineer.session, team.quality2.session, team.manager.session, team.quality.session]) {
  for (let guard = 0; guard < 10; guard++) {
    const active = await ctx.prisma.workflowInstance.findFirst({ where: { subjectId, status: "ACTIVE" } });
    if (!active) return;
    let decided = false;
    for (const s of approvers) {
      const inbox = expectStatus(await s.get("/approvals/inbox"), 200).body as { id: string; subjectId: string; canDecide: boolean }[];
      const item = inbox.find((i) => i.subjectId === subjectId && i.canDecide);
      if (!item) continue;
      expectStatus(await s.post(`/approvals/${item.id}/decision`, { decision: "APPROVE", comment: "Approved in test" }), 201);
      decided = true;
      break;
    }
    if (!decided) throw new Error(`No eligible approver found for subject ${subjectId}`);
  }
}

export async function cleanUpload(ctx: TestContext, s: Session, name = `evidence-${uniq()}.pdf`, bytes = PDF_BYTES) {
  const f = expectStatus(await s.upload("/files", name, bytes), 201).body;
  await waitFor(async () => (await ctx.prisma.fileObject.findUnique({ where: { id: f.id } }))?.status === "CLEAN", 60_000);
  return f as { id: string };
}

/** Creates, submits and approves an uploaded document for a checklist requirement. */
export async function fulfillRequirement(ctx: TestContext, team: Team, requirementId: string, title = `Evidence ${uniq()}`) {
  const s = team.quality.session;
  const created = expectStatus(await s.post(`/required-documents/${requirementId}/create-document`, { title, submissionMethod: "UPLOAD" }), 201).body;
  const file = await cleanUpload(ctx, s);
  expectStatus(await s.post(`/documents/${created.document.id}/revisions/${created.revision.id}/files`, { fileId: file.id }), 201);
  const rev = await ctx.prisma.documentRevision.findUniqueOrThrow({ where: { id: created.revision.id } });
  expectStatus(await s.post(`/documents/${created.document.id}/revisions/${created.revision.id}/submit`, { expectedVersion: rev.version }), 201);
  await decideAll(ctx, team, created.revision.id);
  return created as { document: { id: string }; revision: { id: string } };
}

export interface ProjectInput {
  pathway: "A" | "B" | "C";
  supplierId: string;
  siteId: string;
  reverseEngineering?: boolean;
  criticality?: "LOW" | "MEDIUM" | "HIGH" | "SAFETY_CRITICAL";
  riskFactors?: Record<string, string>;
  specialProcesses?: boolean;
  delta?: boolean;
}

export async function createProject(ctx: TestContext, team: Team, input: ProjectInput) {
  const pn = uniq("PN-").toUpperCase();
  const body = {
    title: `Project ${pn}`,
    businessJustification: "Second source for cost reduction",
    newPart: { partNumber: pn, description: `Test part ${pn}`, criticality: input.criticality ?? "LOW" },
    supplierId: input.supplierId,
    siteId: input.siteId,
    pathway: input.pathway,
    reverseEngineeringRequired: input.reverseEngineering ?? false,
    riskFactors: input.riskFactors ?? LOW_RISK,
    newSupplierPart: input.pathway === "A" ? undefined : { supplierPartNumber: uniq("SPN-").toUpperCase(), description: "Supplier standard part" },
    customPartNumber: input.pathway === "C" ? uniq("CUST-").toUpperCase() : undefined,
    specialProcesses: input.specialProcesses ?? false,
    customerRequirements: input.pathway === "C",
    baseline:
      input.pathway === "A"
        ? input.reverseEngineering
          ? { reverseEngineeringSource: "Physical sample S/N 001" }
          : { drawingNumber: `DWG-${pn}`, drawingRevision: "A", material: "4140 steel" }
        : { specificationNumber: `SPEC-${pn}`, guaranteedCharacteristics: "Flow: 120 kg/min\nBalance: G2.5" },
    deltaRequirements: input.pathway === "C" && input.delta !== false ? [{ category: "COATING", title: "Turbine housing coating", baselineValue: "Uncoated", requiredValue: "Ceramic thermal barrier coating 150-200 um", acceptanceCriteria: "Coating thickness per micrograph; adhesion test" }] : undefined,
    members: [
      { userId: team.engineer.id, role: "ENGINEERING" },
      { userId: team.quality.id, role: "SUPPLIER_QUALITY" },
    ],
  };
  const project = expectStatus(await team.sourcing.session.post("/sourcing-projects", body), 201).body;
  return project as { id: string; version: number; configurationId: string; supplierProductId: string; projectNumber: string };
}

export async function approveIntake(ctx: TestContext, team: Team, projectId: string) {
  const p = await ctx.prisma.sourcingProject.findUniqueOrThrow({ where: { id: projectId } });
  expectStatus(await team.sourcing.session.post(`/sourcing-projects/${projectId}/submit`, { expectedVersion: p.version }), 201);
  await decideAll(ctx, team, projectId);
}

/** Fulfils REQUIRED items with documents and waives CONDITIONAL items (with justification). */
export async function completeChecklist(ctx: TestContext, team: Team, projectId: string, opts: { fulfillConditional?: boolean } = {}) {
  const reqs = await ctx.prisma.requiredDocument.findMany({ where: { projectId, status: { in: ["OPEN", "REJECTED"] } }, include: { documentType: true } });
  for (const r of reqs) {
    if (r.level === "CONDITIONAL" && !opts.fulfillConditional) {
      expectStatus(await team.quality.session.post(`/required-documents/${r.id}/waive`, { justification: `Not needed for this low-risk source (${r.documentType.code})` }), 201);
    } else {
      await fulfillRequirement(ctx, team, r.id, `${r.documentType.code} evidence`);
    }
  }
}

export async function acceptBaselineAndDelta(ctx: TestContext, team: Team, configurationId: string) {
  const rev = await ctx.prisma.configurationRevision.findFirstOrThrow({ where: { configurationId }, orderBy: { revisionNumber: "desc" }, include: { requirements: true } });
  for (const r of rev.requirements) {
    if (r.ackStatus !== "ACKNOWLEDGED") expectStatus(await team.quality.session.post(`/product-configurations/requirements/${r.id}/acknowledge`, { status: "ACKNOWLEDGED", acknowledgedByName: "Supplier Quality Manager" }), 201);
    expectStatus(await team.quality.session.post(`/product-configurations/requirements/${r.id}/verify`, { status: "VERIFIED", note: "Verified against acceptance criteria" }), 201);
  }
  const fresh = await ctx.prisma.configurationRevision.findUniqueOrThrow({ where: { id: rev.id }, include: { baseline: true } });
  if (fresh.baseline?.status !== "ACCEPTED") expectStatus(await team.engineer.session.post(`/product-configurations/revisions/${rev.id}/baseline/accept`, { expectedVersion: fresh.version }), 201);
  return rev.id;
}

/** Records an accepted FAI and an accepted functional test on a qualification. */
export async function recordValidation(team: Team, qualificationId: string) {
  const fai = expectStatus(await team.quality.session.post(`/qualifications/${qualificationId}/first-articles`, { serialNumbers: "SN-001..SN-005", inspectionDate: "2026-10-10", characteristicsInspected: 42, nonconformingCount: 0, outcome: "PASS" }), 201).body;
  expectStatus(await team.quality2.session.post(`/qualifications/first-articles/${fai.id}/review`, { decision: "ACCEPTED", comment: "FAIR complete" }), 201);
  const t = expectStatus(await team.engineer.session.post(`/qualifications/${qualificationId}/tests`, { testType: "PERFORMANCE", name: "Flow and balance test", acceptanceCriteria: "Flow within ±2% of baseline" }), 201).body;
  expectStatus(await team.engineer.session.post(`/qualifications/tests/${t.id}/result`, { outcome: "PASS", resultSummary: "Flow +0.8%, balance G1.8", testedAt: "2026-10-11" }), 201);
  expectStatus(await team.quality.session.post(`/qualifications/tests/${t.id}/review`, { decision: "ACCEPTED", comment: "Meets criteria" }), 201);
}

/** Runs a project all the way to an approved product. Returns ids. */
export async function approvedProduct(ctx: TestContext, team: Team, input: Omit<ProjectInput, "supplierId" | "siteId"> & { supplierId?: string; siteId?: string }) {
  const sup = input.supplierId && input.siteId ? { supplier: { id: input.supplierId }, site: { id: input.siteId } } : await createApprovedSupplier(ctx, team);
  const project = await createProject(ctx, team, { ...input, supplierId: sup.supplier.id, siteId: sup.site.id });
  await approveIntake(ctx, team, project.id);
  await completeChecklist(ctx, team, project.id);
  const revisionId = await acceptBaselineAndDelta(ctx, team, project.configurationId);
  const qual = expectStatus(await team.quality.session.post("/qualifications", { sourcingProjectId: project.id }), 201).body;
  await recordValidation(team, qual.id);
  const fresh = await ctx.prisma.productQualification.findUniqueOrThrow({ where: { id: qual.id } });
  expectStatus(await team.quality.session.post(`/qualifications/${qual.id}/submit`, { expectedVersion: fresh.version }), 201);
  await decideAll(ctx, team, qual.id);
  return { project, qualificationId: qual.id as string, revisionId, supplierId: sup.supplier.id, siteId: sup.site.id };
}
