import { $Enums } from "@sqms/db";
import * as SharedEnums from "@sqms/shared/dist/enums";
import { PDF_BYTES } from "./fixtures";
import { approvedProduct, cleanUpload, createApprovedSupplier } from "./flows";
import { createTeam, createUser, expectStatus, login, startApp, type Session, type Team, type TestContext } from "./helpers";

const toPascal = (name: string) => name.toLowerCase().replace(/(^|_)([a-z])/g, (_m, _s, c: string) => c.toUpperCase());
const SPECIAL: Record<string, string> = { SOURCING_PATHWAY: "SourcingPathwayCode" };

describe("Enum consistency between the shared package and the database schema", () => {
  it("keeps every shared enum identical to its Prisma enum", () => {
    const prismaEnums = $Enums as unknown as Record<string, Record<string, string>>;
    const checked: string[] = [];
    for (const [name, values] of Object.entries(SharedEnums)) {
      if (!Array.isArray(values)) continue;
      const prismaName = SPECIAL[name] ?? toPascal(name);
      const prismaEnum = prismaEnums[prismaName];
      expect({ name, found: !!prismaEnum }).toEqual({ name, found: true });
      expect({ name, values: [...values].sort() }).toEqual({ name, values: Object.values(prismaEnum).sort() });
      checked.push(name);
    }
    expect(checked.length).toBeGreaterThanOrEqual(40);
  });
});

describe("Supplier data isolation, persistence and concurrency", () => {
  let ctx: TestContext;
  let team: Team;
  let a: Awaited<ReturnType<typeof createApprovedSupplier>>;
  let b: Awaited<ReturnType<typeof approvedProduct>>;
  let userA: Session;
  let userB: Session;

  beforeAll(async () => {
    ctx = await startApp({ SUPPLIER_PORTAL_ENABLED: "true" });
    team = await createTeam(ctx);
    a = await createApprovedSupplier(ctx, team);
    b = await approvedProduct(ctx, team, { pathway: "B" });
    const orgA = (await ctx.prisma.supplier.findUniqueOrThrow({ where: { id: a.supplier.id } })).organizationId;
    const orgB = (await ctx.prisma.supplier.findUniqueOrThrow({ where: { id: b.supplierId } })).organizationId;
    userA = await login(ctx, (await createUser(ctx.prisma, { roles: ["SUPPLIER_ADMIN"], organizationId: orgA, userType: "EXTERNAL" })).email);
    userB = await login(ctx, (await createUser(ctx.prisma, { roles: ["SUPPLIER_ADMIN"], organizationId: orgB, userType: "EXTERNAL" })).email);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it("keeps internal-only endpoints closed to supplier users", async () => {
    for (const path of [`/suppliers/${b.supplierId}`, "/suppliers", "/suppliers/export.csv", "/products", "/sourcing-projects", "/qualifications", "/approvals/inbox", "/audit", "/admin/users", "/dashboard", "/incoming-inspections", "/inspection-plans", "/injector-tests", "/injector-repairs", "/inspection-reports", "/quality-alerts", "/quality-signals", "/drawings", "/injector-sheet-exports", "/reports/approved-suppliers", "/change-requests/export.csv", "/ncrs/export.csv"]) {
      const res = await userA.get(path);
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
  });

  it("isolates files and documents between suppliers", async () => {
    // Supplier B uploads a file and authors a supplier-contributed document.
    const file = await cleanUpload(ctx, userB, "b-questionnaire.pdf", PDF_BYTES);
    expect((await userA.get(`/files/${file.id}`)).status).toBe(404);
    expect((await userA.get(`/files/${file.id}/download`)).status).toBe(404);
    expectStatus(await userB.get(`/files/${file.id}/download`), 200);
    const type = await ctx.prisma.documentType.findUniqueOrThrow({ where: { code: "SUP-01" } });
    const created = expectStatus(await userB.post("/documents", { documentTypeId: type.id, title: "Supplier B self-assessment", submissionMethod: "UPLOAD" }), 201).body;
    expect(created.document.supplierId).toBe(b.supplierId);
    // A supplier cannot attach another supplier's file, nor see or edit the document.
    const fileA = await cleanUpload(ctx, userA, "a.pdf", PDF_BYTES);
    expect((await userB.post(`/documents/${created.document.id}/revisions/${created.revision.id}/files`, { fileId: fileA.id })).status).toBe(422);
    expect((await userA.get(`/documents/${created.document.id}`)).status).toBe(404);
    expect((await userA.patch(`/documents/${created.document.id}`, { expectedVersion: 0, title: "Hijacked" })).status).toBe(404);
    const listA = expectStatus(await userA.get("/documents?pageSize=200"), 200).body;
    expect(listA.items.some((d: { id: string }) => d.id === created.document.id)).toBe(false);
    // Client-supplied supplier ids never widen access.
    const spoof = expectStatus(await userA.get(`/documents?supplierId=${b.supplierId}&pageSize=200`), 200).body;
    expect(spoof.items).toHaveLength(0);
    // Internal-only document types cannot be authored by suppliers.
    const internalType = await ctx.prisma.documentType.findFirstOrThrow({ where: { supplierVisibility: "INTERNAL_ONLY" } });
    expect((await userA.post("/documents", { documentTypeId: internalType.id, title: "Not allowed", submissionMethod: "UPLOAD" })).status).toBe(403);
  });

  it("isolates change requests, quality records, tasks and comments", async () => {
    const q = await ctx.prisma.productQualification.findUniqueOrThrow({ where: { id: b.qualificationId } });
    const crB = expectStatus(await userB.post("/change-requests", { supplierProductId: q.supplierProductId, title: "Supplier B tooling change", categories: ["EQUIPMENT_TOOLING"], reason: "New press line", description: "Replace press 3 with press 7 of the same model" }), 201).body;
    expect(crB.submittedByOrganizationId).not.toBe((await ctx.prisma.organization.findUniqueOrThrow({ where: { code: "INTERNAL" } })).id);
    // Supplier A can neither read nor raise changes against B's product.
    expect((await userA.get(`/change-requests/${crB.id}`)).status).toBe(404);
    expect((await userA.post(`/change-requests/${crB.id}/submit`, { expectedVersion: crB.version })).status).toBe(404);
    expect((await userA.post("/change-requests", { supplierProductId: q.supplierProductId, title: "Spoofed change", categories: ["PROCESS"], reason: "Spoof attempt", description: "Attempt to change another supplier's product" })).status).toBe(404);
    expect((await userA.get(`/change-requests?supplierId=${b.supplierId}`)).body.items).toHaveLength(0);
    // Supplier B cannot perform internal review steps on its own change.
    expect((await userB.post(`/change-requests/${crB.id}/impact-assessments`, { discipline: "ENGINEERING", impactSummary: "Self assessed", recommendation: "APPROVE" })).status).toBe(403);
    const detail = expectStatus(await userB.get(`/change-requests/${crB.id}`), 200).body;
    expect(detail.impactAssessments).toBeUndefined();

    // Tasks assigned to supplier B's organization are not actionable by supplier A.
    const orgB = (await ctx.prisma.supplier.findUniqueOrThrow({ where: { id: b.supplierId } })).organizationId;
    const task = await ctx.prisma.task.create({ data: { title: "Upload updated control plan", type: "DOCUMENT_SUBMISSION", assigneeOrganizationId: orgB } });
    expect((await userA.patch(`/tasks/${task.id}`, { status: "IN_PROGRESS" })).status).toBe(404);
    expect(expectStatus(await userA.get("/tasks"), 200).body.items.some((t: { id: string }) => t.id === task.id)).toBe(false);
    expectStatus(await userB.patch(`/tasks/${task.id}`, { status: "IN_PROGRESS" }), 200);

    // Comments, activity and approval history follow record access.
    expect((await userA.get(`/comments?entityType=CHANGE_REQUEST&entityId=${crB.id}`)).status).toBe(404);
    expect((await userA.get(`/activity/CHANGE_REQUEST/${crB.id}`)).status).toBe(404);
    expect((await userA.post("/comments", { entityType: "CHANGE_REQUEST", entityId: crB.id, body: "Snooping" })).status).toBe(404);
    const portal = expectStatus(await userA.get("/portal/overview"), 200).body;
    expect(portal.supplier.id).toBe(a.supplier.id);
    expect((await team.quality.session.get("/portal/overview")).status).toBe(403);
  });

  it("persists records across application restarts", async () => {
    const s = expectStatus(await team.sourcing.session.post("/suppliers", { name: "Persistence Check Ltd", country: "GB", sites: [{ siteCode: "P1", name: "Plant 1", city: "Leeds", country: "GB" }] }), 201).body;
    await ctx.close();
    ctx = await startApp({ SUPPLIER_PORTAL_ENABLED: "true" });
    const relogin = await login(ctx, (await ctx.prisma.user.findUniqueOrThrow({ where: { id: team.sourcing.id } })).email);
    team.sourcing.session = relogin;
    const fetched = expectStatus(await relogin.get(`/suppliers/${s.id}`), 200).body;
    expect(fetched.name).toBe("Persistence Check Ltd");
    expect(fetched.supplierNumber).toBe(s.supplierNumber);
    expect(await ctx.prisma.auditEvent.count({ where: { entityId: s.id, eventType: "supplier.created" } })).toBe(1);
  });

  it("serializes concurrent edits with optimistic versions", async () => {
    const s = expectStatus(await team.sourcing.session.post("/suppliers", { name: "Concurrency Check GmbH", country: "DE" }), 201).body;
    const results = await Promise.all([
      team.sourcing.session.patch(`/suppliers/${s.id}`, { expectedVersion: s.version, notes: "Edit one" }),
      team.sourcing.session.patch(`/suppliers/${s.id}`, { expectedVersion: s.version, notes: "Edit two" }),
      team.sourcing.session.patch(`/suppliers/${s.id}`, { expectedVersion: s.version, notes: "Edit three" }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409]);
    const final = await ctx.prisma.supplier.findUniqueOrThrow({ where: { id: s.id } });
    expect(final.version).toBe(s.version + 1);
  });
});
