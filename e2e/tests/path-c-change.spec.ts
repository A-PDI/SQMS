/**
 * Demo 1: Pathway C (modified supplier product) - a turbocharger whose turbine housing receives a ceramic thermal
 * barrier coating, sourced from an approved supplier, qualified and approved; then a supplier change to the
 * coating sub-tier is requalified and approved while the previously authorized configuration is preserved.
 *
 * The browser performs the decisions a user makes (wizard, waiver, qualification evidence, submissions,
 * approvals, change request). Routine evidence uploads and the remaining approval steps use the same REST API.
 */
import { expect, test } from "@playwright/test";
import { Team, uniq } from "./support/api";
import { confirmAction, idFromUrl, login, pick } from "./support/ui";

interface Requirement {
  id: string;
  level: string;
  status: string;
  documentType: { code: string; nativeModule: string | null };
}
interface Project {
  id: string;
  status: string;
  supplierProductId: string;
  configuration: { revisions: { id: string; revisionLabel: string; status: string }[] };
  requirements: Requirement[];
}

test.describe.serial("Pathway C turbocharger with ceramic coating, then a supplier change", () => {
  const team = new Team();
  const pn = uniq("TC-E2E-");
  let projectId = "";
  let qualificationId = "";
  let supplierProductId = "";
  let changeId = "";

  test.afterAll(async () => {
    await team.dispose();
  });

  test("sourcing creates the Pathway C project with the wizard; the checklist is generated from policy", async ({ page }) => {
    await login(page, "sourcing");
    await page.goto("/projects/new");

    // 1. Product
    await page.getByLabel("Project title").fill(`${pn} turbocharger, ceramic-coated turbine housing`);
    await page.getByLabel("Business justification").fill("Second source for the 13L turbocharger; coating improves thermal durability");
    await page.getByLabel("Internal part number").fill(pn);
    await page.getByRole("textbox", { name: "Description", exact: true }).fill("Turbocharger 13L with ceramic thermal barrier coating (E2E demo)");
    await page.getByRole("button", { name: "Continue" }).click();

    // 2. Supplier & site: an approved supplier from the demo data
    await pick(page, "Search supplier", "Apex", /Apex Turbo Systems/);
    const siteValue = await page.locator("#site option", { hasText: "DAY" }).getAttribute("value");
    await page.locator("#site").selectOption(siteValue!);
    await page.getByRole("button", { name: "Continue" }).click();

    // 3. Pathway C
    await page.getByRole("button", { name: /Pathway C - Modified existing supplier product/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    // 4. Risk assessment (defaults) - the computed level is shown before continuing
    await expect(page.getByText("Computed risk")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    // 5. Technical baseline: supplier standard product plus the coating delta
    await page.locator("#spn").fill(`AT-880-${pn}`);
    await page.locator("#cpn").fill(`AT-880-${pn}-C1`);
    await page.locator("#spec").fill("APX-SPEC-880");
    await page.locator("#specrev").fill("D");
    await page.locator("#guar").fill("Compressor map per APX-880-MAP rev D\nRotor balance G2.5");
    await page.getByRole("checkbox", { name: /Special processes involved/ }).click();
    await page.locator("#splist").fill("Thermal spray ceramic coating (sub-tier)");
    await page.getByRole("button", { name: "Add requirement" }).click();
    await page.locator("#delta-0-category").selectOption("COATING");
    await page.locator("#delta-0-title").fill("Turbine housing thermal barrier coating");
    await page.locator("#delta-0-baseline").fill("Uncoated Ni-resist housing");
    await page.locator("#delta-0-required").fill("Yttria-stabilized zirconia 150-250 um over bond coat");
    await page.locator("#delta-0-criteria").fill("Thickness by micrograph at 3 locations; adhesion >= 20 MPa");
    await page.getByRole("button", { name: "Continue" }).click();

    // 6. Document requirements preview: Pathway C delta specification and coating certificates are required
    const preview = page.getByRole("table");
    await expect(preview.getByRole("row", { name: /ENG-06/ })).toContainText("Required");
    await expect(preview.getByRole("row", { name: /VAL-04/ })).toContainText("Required");
    await page.getByRole("button", { name: "Continue" }).click();

    // 7. Team, 8. Review & submit (submission for intake review is preselected)
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText(`${pn} (new)`)).toBeVisible();
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
    projectId = idFromUrl(page);

    await expect(page.getByText("C - Modified existing supplier product")).toBeVisible();
    await expect(page.getByText(/Generated .* from Sourcing document requirements v\d+/)).toBeVisible();
    await expect(page.getByRole("row", { name: /ENG-06/ })).toBeVisible();
  });

  test("intake is approved, a conditional item is waived with justification and the evidence is completed", async ({ page }) => {
    await team.approveAll(projectId);

    // Supplier Quality waives one conditional requirement from the checklist UI.
    await login(page, "quality");
    await page.goto(`/projects/${projectId}`);
    const quality = await team.as("quality");
    const before = await quality.get<Project>(`/sourcing-projects/${projectId}`);
    const conditional = before.requirements.find((r) => r.level === "CONDITIONAL" && r.status === "OPEN");
    expect(conditional, "the Pathway C checklist has conditional items").toBeTruthy();
    await page.getByRole("button", { name: `Actions for ${conditional!.documentType.code}` }).click();
    await page.getByRole("menuitem", { name: "Waive with justification" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Justification").fill("Existing approved supplier; current record on file covers this source.");
    await dialog.getByRole("button", { name: "Waive requirement" }).click();
    await expect(page.getByRole("row", { name: new RegExp(conditional!.documentType.code) })).toContainText("Waived");

    // Remaining evidence: conditional items waived, required items uploaded, submitted and approved.
    const project = await quality.get<Project>(`/sourcing-projects/${projectId}`);
    for (const r of project.requirements.filter((x) => x.status === "OPEN" || x.status === "REJECTED")) {
      if (r.level === "CONDITIONAL") await quality.post(`/required-documents/${r.id}/waive`, { justification: `Not applicable to this demo source (${r.documentType.code})` });
      else await team.fulfilRequirement(r.id, `${r.documentType.code} ${pn}`);
    }
    // Supplier acknowledgment of the delta requirement and engineering acceptance of the baseline.
    await team.acceptBaselineAndDelta(project.configuration.revisions[0].id);
    supplierProductId = project.supplierProductId;

    await page.reload();
    await expect(page.getByText("100% complete")).toBeVisible();
  });

  test("quality opens the qualification, records validation evidence and the product is approved", async ({ page }) => {
    await login(page, "quality");
    await page.goto(`/projects/${projectId}`);
    await page.getByRole("tab", { name: /Qualification/ }).click();
    await confirmAction(page, "Open product qualification", "Open qualification");
    await page.waitForURL(/\/qualifications\/[0-9a-f-]{36}$/);
    qualificationId = idFromUrl(page);

    // The approval gate shows what is missing; status changes cannot bypass it.
    await expect(page.getByText("Required testing and validation accepted")).toBeVisible();
    await expect(page.getByLabel("Failed").first()).toBeVisible();

    // First article inspection
    await page.getByRole("tab", { name: /First articles/ }).click();
    await page.getByRole("button", { name: "Record FAI" }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Inspection date").fill("2026-10-12");
    await dialog.getByLabel("Characteristics inspected").fill("64");
    await dialog.getByLabel("Serial numbers").fill("DAY-E2E-001 to DAY-E2E-005");
    await dialog.getByLabel("Summary").fill("All characteristics conforming; coating 180-220 um");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();

    // Coating adhesion test planned and recorded by quality; reviews are made by a second person.
    await page.getByRole("tab", { name: /Tests/ }).click();
    await page.getByRole("button", { name: "Plan test" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Type").selectOption("COATING");
    await dialog.getByLabel("Name").fill("Coating adhesion and thickness");
    await dialog.getByLabel("Acceptance criteria").fill("Adhesion >= 20 MPa; thickness 150-250 um at 3 locations");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Record result" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Result summary").fill("Adhesion 31 MPa; thickness 182-214 um");
    await dialog.getByLabel("Laboratory").fill("Company materials lab");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();

    const reviewer = await team.as("quality2");
    const q = await reviewer.get<{ tests: { id: string }[]; firstArticles: { id: string }[] }>(`/qualifications/${qualificationId}`);
    for (const f of q.firstArticles) await reviewer.post(`/qualifications/first-articles/${f.id}/review`, { decision: "ACCEPTED", comment: "FAIR complete and conforming" });
    for (const t of q.tests) await reviewer.post(`/qualifications/tests/${t.id}/review`, { decision: "ACCEPTED", comment: "Meets acceptance criteria" });

    // Every gate check passes now; submit for approval.
    await page.reload();
    await expect(page.getByLabel("Failed")).toHaveCount(0);
    await confirmAction(page, "Submit for approval", "Submit");
    await expect(page.getByText("Approval review").first()).toBeVisible();

    // The approver decides from the approvals inbox; remaining steps are completed by their role holders.
    await login(page, "approver");
    await page.goto("/approvals");
    const row = page.getByRole("row", { name: new RegExp(pn) });
    if (await row.count()) {
      await row.getByRole("button", { name: "Approve" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
    }
    await team.approveAll(qualificationId);

    await page.goto(`/qualifications/${qualificationId}`);
    await expect(page.getByText(/Product approval PA-\d{4}-\d{4}/)).toBeVisible();
    await expect(page.getByText("Approved").first()).toBeVisible();
  });

  test("a coating sub-tier change is requalified and approved; the previous configuration is preserved", async ({ page }) => {
    await login(page, "quality");
    await page.goto(`/changes/new?supplierProductId=${supplierProductId}`);
    await page.getByLabel("Title").fill(`Change thermal barrier coating sub-tier for ${pn}`);
    await page.getByRole("checkbox", { name: "Coating" }).click();
    await page.getByRole("checkbox", { name: "Sub tier" }).click();
    await page.getByLabel("Reason for change").fill("Current coating sub-tier is consolidating plants");
    await page.getByLabel("Description of the change").fill("Move thermal spray coating to an alternate qualified sub-tier with the same powder and parameters; new equipment.");
    await page.getByRole("button", { name: "Create draft" }).click();
    await page.waitForURL(/\/changes\/[0-9a-f-]{36}$/);
    changeId = idFromUrl(page);
    await confirmAction(page, /^Submit$/, "Submit");

    // Impact assessments: engineering through the API, quality in the UI; then the requalification decision.
    const engineer = await team.as("engineer");
    await engineer.post(`/change-requests/${changeId}/impact-assessments`, { discipline: "ENGINEERING", impactSummary: "Equivalent process; new equipment requires coating validation", recommendation: "APPROVE_WITH_CONDITIONS", requiresFai: true, requiresMaterialCertificates: true });
    await page.getByRole("button", { name: "Add impact assessment" }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Discipline").selectOption("QUALITY");
    await dialog.getByLabel("Recommendation").selectOption("APPROVE");
    await dialog.getByLabel("Impact summary").fill("New sub-tier must be added to the approved sub-tier list");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Requalification decision" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Change risk level").selectOption("MEDIUM");
    await dialog.getByRole("button", { name: "Record decision" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Validation required").first()).toBeVisible();

    // The proposed configuration is a separate revision; the authorized one stays approved meanwhile.
    await expect(page.getByText("Currently authorized")).toBeVisible();
    await expect(page.getByText(/rev A/).first()).toBeVisible();
    await expect(page.getByText(/rev B/).first()).toBeVisible();

    // Requalification evidence (API): proposed baseline, required documents and a first article.
    const quality = await team.as("quality");
    const cr = await quality.get<{ proposedRevisionId: string; requiredDocuments: Requirement[]; requalification: { id: string } }>(`/change-requests/${changeId}`);
    const proposed = await quality.get<{ version: number }>(`/product-configurations/revisions/${cr.proposedRevisionId}`);
    await engineer.put(`/product-configurations/revisions/${cr.proposedRevisionId}/baseline`, { expectedVersion: proposed.version, coating: "YSZ thermal barrier coating applied by alternate sub-tier (E2E)" });
    for (const r of cr.requiredDocuments.filter((x) => x.status === "OPEN")) await team.fulfilRequirement(r.id, `${r.documentType.code} change ${pn}`);
    await team.acceptBaselineAndDelta(cr.proposedRevisionId);
    const fai = await quality.post<{ id: string }>(`/qualifications/${cr.requalification.id}/first-articles`, { serialNumbers: "COL-E2E-001..005", inspectionDate: "2026-10-14", characteristicsInspected: 12, nonconformingCount: 0, outcome: "PASS" });
    await (await team.as("quality2")).post(`/qualifications/first-articles/${fai.id}/review`, { decision: "ACCEPTED", comment: "Coating FAI conforming" });

    // The comparison shows the proposed coating against the authorized baseline, and the gate now passes.
    await page.reload();
    await expect(page.getByRole("cell", { name: "YSZ thermal barrier coating applied by alternate sub-tier (E2E)" })).toBeVisible();
    await expect(page.getByLabel("Failed")).toHaveCount(0);
    await confirmAction(page, "Submit for approval", "Submit for approval", { label: "Conditions of approval (optional)", text: "First 3 lots: 100% coating thickness inspection" });
    await team.approveAll(changeId);

    await page.reload();
    await expect(page.getByText("Approved").first()).toBeVisible();
    await confirmAction(page, "Verify implementation", "Verify", { label: "Implementation verification notes", text: "First production lot micrographs reviewed and conforming" });
    await expect(page.getByText(/Shipments of the changed configuration authorized/)).toBeVisible();

    // History is preserved: rev B is now authorized and rev A superseded (not overwritten).
    await page.goto(`/products/supplier-products/${supplierProductId}`);
    const revB = page.getByRole("row", { name: /\bB\b.*Approved|Approved.*\bB\b/ });
    await expect(revB.getByText("Authorized")).toBeVisible();
    await expect(page.getByRole("row", { name: /Superseded/ }).first()).toBeVisible();
  });
});
