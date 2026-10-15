/**
 * Demo 2: a nonconformance found at incoming inspection is contained, a corrective action request (8D) is raised
 * and issued, the supplier's response is reviewed by a second person, effectiveness is verified, and both records
 * are closed. Internal notes stay internal throughout.
 */
import { expect, test } from "@playwright/test";
import { Team, uniq } from "./support/api";
import { confirmAction, idFromUrl, login } from "./support/ui";

test.describe.serial("NCR with containment, 8D corrective action and closure", () => {
  const team = new Team();
  const lot = uniq("LOT-");
  let ncrId = "";
  let scarId = "";

  test.afterAll(async () => {
    await team.dispose();
  });

  test("quality records the NCR and containment, then raises and issues a SCAR", async ({ page }) => {
    const quality = await team.as("quality");
    const sources = await quality.get<{ items: { id: string }[] }>("/supplier-products", { status: "APPROVED", pageSize: 1 });
    expect(sources.items.length, "the demo data includes an approved supplier product").toBeGreaterThan(0);

    await login(page, "quality");
    await page.goto(`/quality/ncrs/new?supplierProductId=${sources.items[0].id}`);
    await page.getByLabel("Title").fill(`Coating thickness below minimum on ${lot}`);
    await page.getByLabel("Lot / batch").fill(lot);
    await page.getByLabel("Quantity affected").fill("6");
    await page.getByLabel("Quantity inspected").fill("20");
    await page.getByLabel("Defect description").fill("Coating thickness 120-140 um measured on 6 of 20 sampled housings; requirement 150-250 um.");
    await page.getByLabel("Expected specification").fill("150-250 um per delta specification");
    await page.getByLabel("Internal notes (never shown to suppliers)").fill("Possible link to the spray nozzle maintenance interval; do not share with the supplier yet.");
    await page.getByRole("button", { name: "Create NCR" }).click();
    await page.waitForURL(/\/quality\/ncrs\/[0-9a-f-]{36}$/);
    ncrId = idFromUrl(page);
    await expect(page.getByText(/NCR-\d{4}-\d{4}/).first()).toBeVisible();

    await page.getByRole("button", { name: "Containment" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Containment action").fill("Lot segregated at receiving; stock and in-transit material sorted 100%");
    await dialog.getByRole("checkbox", { name: "Containment completed" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/Completed /)).toBeVisible();

    await confirmAction(page, "Raise SCAR", "Create SCAR");
    await page.waitForURL(/\/quality\/scars\/[0-9a-f-]{36}$/);
    scarId = idFromUrl(page);
    await confirmAction(page, "Issue to supplier", "Issue");
    await expect(page.getByText("Issued").first()).toBeVisible();
  });

  test("the supplier 8D response is entered and then accepted by a second reviewer", async ({ page }) => {
    // Phase 1: supplier logins are disabled, so Supplier Quality enters the response on the supplier's behalf.
    await login(page, "quality");
    await page.goto(`/quality/scars/${scarId}`);
    await page.getByLabel("Supplier representative providing the response").fill("Dana Brooks, Supplier Quality Manager (fictional)");
    const sections: [string, string][] = [
      ["D1 Team", "Supplier QE, coating process engineer, sub-tier liaison"],
      ["D2 Problem description", `Coating thickness below 150 um on lot ${lot}`],
      ["D3 Interim containment", "Stock sorted 100%; 6 housings recoated and re-measured"],
      ["D4 Root cause (occurrence)", "Worn spray nozzle reduced deposition rate; nozzle life was not controlled"],
      ["D4 Escape point", "Thickness sampled per shift instead of per batch"],
      ["D5 Permanent corrective actions", "Nozzle replacement every 40 spray hours; thickness check per batch"],
      ["D6 Implementation", "Implemented on all spray cells with updated work instructions"],
      ["D7 Prevent recurrence", "Nozzle life added to PFMEA and control plan; similar coatings reviewed"],
    ];
    for (const [label, text] of sections) await page.getByRole("textbox", { name: label, exact: true }).fill(text);
    await page.getByRole("button", { name: "Submit response" }).click();
    await expect(page.getByText("Response submitted").first()).toBeVisible();

    // The person who entered the response cannot review it (four-eyes rule enforced by the server).
    const quality = await team.as("quality");
    const scar = await quality.get<{ responses: { id: string; status: string }[] }>(`/scars/${scarId}`);
    const response = scar.responses.find((r) => r.status === "SUBMITTED")!;
    expect(await quality.postStatus(`/scars/${scarId}/responses/${response.id}/review`, { decision: "ACCEPTED", comment: "Self review attempt" })).toBe(403);

    await login(page, "quality2");
    await page.goto(`/quality/scars/${scarId}`);
    await confirmAction(page, "Review response", "Record review", { label: "Review comment", text: "Root cause verified; corrective actions adequate" });
    await expect(page.getByText("Accepted").first()).toBeVisible();
  });

  test("effectiveness is verified, the SCAR is closed and the NCR is dispositioned and closed", async ({ page }) => {
    await login(page, "quality2");
    await page.goto(`/quality/scars/${scarId}`);
    await confirmAction(page, "Verify effectiveness", "Record verification", { label: "Verification notes (evidence reviewed)", text: "Three subsequent lots measured 180-220 um" });
    await confirmAction(page, "Close SCAR", "Close", { label: "Closure comment", text: "Corrective action effective" });
    await expect(page.getByText(/Closed .*2\d{3}/).first()).toBeVisible();

    await page.goto(`/quality/ncrs/${ncrId}`);
    await page.getByRole("button", { name: "Disposition" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Disposition", { exact: true }).selectOption("REWORK");
    await dialog.getByLabel("Disposition notes").fill("Recoat the 6 nonconforming housings at the supplier; re-measure thickness");
    await dialog.getByRole("button", { name: "Record disposition" }).click();
    await expect(dialog).toBeHidden();
    await confirmAction(page, "Close NCR", "Close", { label: "Closure comment", text: "Reworked housings re-inspected and conforming" });
    await expect(page.getByText(/Closed .*2\d{3}/).first()).toBeVisible();

    // Internal notes are retained on the record and never exposed through supplier-scoped access.
    await expect(page.getByText("Possible link to the spray nozzle maintenance interval")).toBeVisible();
  });
});
