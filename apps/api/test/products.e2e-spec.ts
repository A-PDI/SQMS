import { createTeam, expectStatus, startApp, uniq, type Team, type TestContext } from "./helpers";

describe("Product master, cross-references and configuration control", () => {
  let ctx: TestContext;
  let team: Team;
  let supplierId: string;
  let siteId: string;
  let otherSiteId: string;

  beforeAll(async () => {
    ctx = await startApp();
    team = await createTeam(ctx);
    const s = expectStatus(await team.sourcing.session.post("/suppliers", { name: `Garrett-like Turbo ${uniq()}`, country: "US", sites: [{ siteCode: "TX1", name: "Texas Plant", city: "Houston", country: "US" }] }), 201).body;
    supplierId = s.id;
    siteId = (await ctx.prisma.supplierSite.findFirstOrThrow({ where: { supplierId } })).id;
    const other = expectStatus(await team.sourcing.session.post("/suppliers", { name: `Other ${uniq()}`, country: "US", sites: [{ siteCode: "X", name: "X", city: "X", country: "US" }] }), 201).body;
    otherSiteId = (await ctx.prisma.supplierSite.findFirstOrThrow({ where: { supplierId: other.id } })).id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it("creates a product with OEM cross-references and a supplier part cross-reference", async () => {
    const cat = await ctx.prisma.productCategory.findUniqueOrThrow({ where: { code: "TURBOCHARGERS" } });
    const pn = uniq("TC-").toUpperCase();
    const part = expectStatus(await team.engineer.session.post("/products", { partNumber: pn, description: "Turbocharger assembly, HD 15L", categoryId: cat.id, criticality: "HIGH" }), 201).body;
    expectStatus(await team.engineer.session.post(`/products/${part.id}/oem-references`, { oemName: "Cummins", oemPartNumber: "4089754" }), 201);
    const sp = expectStatus(await team.engineer.session.post("/supplier-parts", { supplierId, supplierPartNumber: "GT-4294", description: "GT42 turbo" }), 201).body;
    expectStatus(await team.engineer.session.post("/part-cross-references", { internalPartId: part.id, supplierPartId: sp.id }), 201);
    expect((await team.engineer.session.post("/part-cross-references", { internalPartId: part.id, supplierPartId: sp.id })).status).toBe(409);
    const found = expectStatus(await team.readOnly.session.get(`/products?q=4089754`), 200).body;
    expect(found.items.map((p: { id: string }) => p.id)).toContain(part.id);
    const bySupplierPn = expectStatus(await team.readOnly.session.get(`/products?q=GT-4294`), 200).body;
    expect(bySupplierPn.items.map((p: { id: string }) => p.id)).toContain(part.id);
    expect((await team.readOnly.session.post("/products", { partNumber: "NOPE", description: "nope" })).status).toBe(403);
  });

  it("validates the supplier-product-site relationship and configuration rules", async () => {
    const part = expectStatus(await team.engineer.session.post("/products", { partNumber: uniq("CH-").toUpperCase(), description: "Cylinder head" }), 201).body;
    const sp = expectStatus(await team.engineer.session.post("/supplier-parts", { supplierId, supplierPartNumber: uniq("SP-").toUpperCase(), description: "Head" }), 201).body;
    expect((await team.engineer.session.post("/supplier-products", { internalPartId: part.id, supplierPartId: sp.id, siteId: otherSiteId })).status).toBe(422);
    const prod = expectStatus(await team.engineer.session.post("/supplier-products", { internalPartId: part.id, supplierPartId: sp.id, siteId }), 201).body;
    expect(prod.status).toBe("PROPOSED");
    expect((await team.engineer.session.post("/supplier-products", { internalPartId: part.id, supplierPartId: sp.id, siteId })).status).toBe(409);
    // Path C requires a base configuration
    const bad = await team.engineer.session.post("/product-configurations", { supplierProductId: prod.id, name: "Custom", configurationType: "SUPPLIER_MODIFIED" });
    expect(bad.status).toBe(422);
    const base = expectStatus(await team.engineer.session.post("/product-configurations", { supplierProductId: prod.id, name: "Standard GT42", configurationType: "SUPPLIER_STANDARD" }), 201).body;
    const custom = expectStatus(
      await team.engineer.session.post("/product-configurations", { supplierProductId: prod.id, name: "GT42 with ceramic coating", configurationType: "SUPPLIER_MODIFIED", baseConfigurationId: base.configuration.id, customPartNumber: "GT-4294-PDI" }),
      201,
    ).body;
    expect(custom.revision.revisionLabel).toBe("A");
    const rev = expectStatus(await team.readOnly.session.get(`/product-configurations/revisions/${custom.revision.id}`), 200).body;
    expect(rev.baseline.baselineType).toBe("SUPPLIER_BASELINE_WITH_DELTA");
    expect(rev.configuration.baseConfiguration.id).toBe(base.configuration.id);
  });

  it("controls baseline acceptance, delta acknowledgment/verification and locks controlled revisions", async () => {
    const part = expectStatus(await team.engineer.session.post("/products", { partNumber: uniq("INJ-").toUpperCase(), description: "Fuel injector" }), 201).body;
    const sp = expectStatus(await team.engineer.session.post("/supplier-parts", { supplierId, supplierPartNumber: uniq("INJ-").toUpperCase(), description: "Injector" }), 201).body;
    const prod = expectStatus(await team.engineer.session.post("/supplier-products", { internalPartId: part.id, supplierPartId: sp.id, siteId }), 201).body;
    const base = expectStatus(await team.engineer.session.post("/product-configurations", { supplierProductId: prod.id, name: "Std", configurationType: "SUPPLIER_STANDARD" }), 201).body;
    const custom = expectStatus(await team.engineer.session.post("/product-configurations", { supplierProductId: prod.id, name: "Tight tolerance", configurationType: "SUPPLIER_MODIFIED", baseConfigurationId: base.configuration.id }), 201).body;
    const revId = custom.revision.id;
    let rev = expectStatus(await team.engineer.session.get(`/product-configurations/revisions/${revId}`), 200).body;

    // Incomplete baseline cannot be accepted
    const incomplete = await team.engineer.session.post(`/product-configurations/revisions/${revId}/baseline/accept`, { expectedVersion: rev.version });
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.error.details.problems.length).toBeGreaterThan(0);

    expectStatus(await team.engineer.session.put(`/product-configurations/revisions/${revId}/baseline`, { expectedVersion: rev.version, specificationNumber: "SPEC-INJ-9", performanceRequirements: "Flow 1200 cc/min @ 100 bar" }), 200);
    const req = expectStatus(
      await team.engineer.session.post(`/product-configurations/revisions/${revId}/requirements`, { category: "DIMENSIONAL", title: "Nozzle bore tolerance", baselineValue: "±0.010 mm", requiredValue: "±0.005 mm", acceptanceCriteria: "CMM 100% first article, Cpk ≥ 1.67" }),
      201,
    ).body;
    expect(req.code).toBe("REQ-001");
    // Cannot verify before supplier acknowledgment
    expect((await team.quality.session.post(`/product-configurations/requirements/${req.id}/verify`, { status: "VERIFIED", note: "checked" })).status).toBe(422);
    expectStatus(await team.quality.session.post(`/product-configurations/requirements/${req.id}/acknowledge`, { status: "ACKNOWLEDGED", acknowledgedByName: "Supplier QA Manager" }), 201);
    // Content edit resets acknowledgment
    const edited = expectStatus(await team.engineer.session.patch(`/product-configurations/requirements/${req.id}`, { requiredValue: "±0.004 mm" }), 200).body;
    expect(edited.ackStatus).toBe("PENDING");
    expectStatus(await team.quality.session.post(`/product-configurations/requirements/${req.id}/acknowledge`, { status: "ACKNOWLEDGED", acknowledgedByName: "Supplier QA Manager" }), 201);
    expectStatus(await team.quality.session.post(`/product-configurations/requirements/${req.id}/verify`, { status: "VERIFIED", note: "FAI shows compliance" }), 201);
    const ch = expectStatus(await team.engineer.session.post(`/product-configurations/revisions/${revId}/characteristics`, { name: "Nozzle bore", classification: "CRITICAL", nominal: 0.18, tolerancePlus: 0.004, toleranceMinus: 0.004, unit: "mm", customerRequirementId: req.id }), 201).body;
    expect(ch.source).toBe("DELTA");

    rev = expectStatus(await team.engineer.session.get(`/product-configurations/revisions/${revId}`), 200).body;
    const stale = await team.engineer.session.post(`/product-configurations/revisions/${revId}/baseline/accept`, { expectedVersion: rev.version - 1 });
    expect(stale.status).toBe(409);
    const accepted = expectStatus(await team.engineer.session.post(`/product-configurations/revisions/${revId}/baseline/accept`, { expectedVersion: rev.version }), 201).body;
    expect(accepted.status).toBe("ACCEPTED");

    // Once controlled (approved), the revision cannot be edited silently.
    await ctx.prisma.configurationRevision.update({ where: { id: revId }, data: { status: "APPROVED" } });
    const locked = await team.engineer.session.post(`/product-configurations/revisions/${revId}/requirements`, { category: "COATING", title: "Coating thickness", requiredValue: "20 um", acceptanceCriteria: "Measured" });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe("CONTROLLED_RECORD");
    rev = expectStatus(await team.engineer.session.get(`/product-configurations/revisions/${revId}`), 200).body;
    expect((await team.engineer.session.put(`/product-configurations/revisions/${revId}/baseline`, { expectedVersion: rev.version, material: "changed" })).status).toBe(409);

    // A new revision copies the definition and leaves the approved revision untouched.
    await ctx.prisma.productConfiguration.update({ where: { id: custom.configuration.id }, data: { currentApprovedRevisionId: revId } });
    const revB = expectStatus(await team.engineer.session.post(`/product-configurations/${custom.configuration.id}/revisions`, { changeSummary: "Internal engineering update" }), 201).body;
    expect(revB.revisionLabel).toBe("B");
    const b = expectStatus(await team.engineer.session.get(`/product-configurations/revisions/${revB.id}`), 200).body;
    expect(b.requirements).toHaveLength(1);
    expect(b.characteristics[0].customerRequirementId).toBe(b.requirements[0].id);
    expect(b.derivedFrom.id).toBe(revId);
    expect((await team.engineer.session.post(`/product-configurations/${custom.configuration.id}/revisions`, { changeSummary: "Second open revision" })).status).toBe(409);
    const original = await ctx.prisma.configurationRevision.findUniqueOrThrow({ where: { id: revId }, include: { requirements: true } });
    expect(original.status).toBe("APPROVED");
    expect(original.requirements[0].requiredValue).toBe("±0.004 mm");
  });
});
