import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
import { Team, DEMO_PASSWORD, uniq } from "./support/api";
import { login } from "./support/ui";
const { benchReport } = createRequire(
  path.resolve(__dirname, "../..", "packages/legacy-domain/index.js"),
)("./test/helpers/benchData");
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);

test.describe.serial("Unified operational QMS", () => {
  const team = new Team();
  const email = `${uniq("inspector-")}@browser.fixture`;
  let standardRevision = "",
    customRevision = "";
  test.beforeAll(async () => {
    const admin = await team.as("admin"),
      engineer = await team.as("engineer");
    await admin.post("/admin/users/local", {
      email,
      displayName: "Browser fixture inspector",
      password: DEMO_PASSWORD,
      roleKeys: ["INSPECTOR"],
    });
    await engineer.post("/inspection-plans/install-standard");
    const plans = await engineer.get<any[]>("/inspection-plans");
    const p = plans.find((p) => p.code === "PDI-IQI-001");
    const r =
      p.revisions.find((r: any) => r.status === "RELEASED") ??
      (await engineer.post<any>(
        `/inspection-plans/revisions/${p.revisions[0].id}/release`,
      ));
    standardRevision = r.id;
    const custom = await engineer.post<any>("/inspection-plans", {
      code: uniq("UI-CUSTOM-"),
      title: "Miscellaneous surface check",
      definition: {
        header_schema: [
          "part_number",
          "po_number",
          "description",
          "date_received",
          "inspector_name",
        ],
        sections: {
          visual: {
            title: "Visual inspection",
            section_type: "pass_fail_checklist",
            items: [{ id: 1, name: "Mounting face", requirement: "No gouges" }],
          },
        },
      },
    });
    customRevision = (
      await engineer.post<any>(
        `/inspection-plans/revisions/${custom.revisions[0].id}/release`,
      )
    ).id;
  });
  test.afterAll(async () => team.dispose());
  async function inspectorLogin(page: Page) {
    await page.goto("/login");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  }
  async function newInspection(
    page: Page,
    revision: string,
    count: number,
    part: string,
  ) {
    await page.goto("/incoming/new");
    await page.getByLabel("Released inspection plan").selectOption(revision);
    await page.getByLabel("Item count").fill(String(count));
    await page.getByLabel("Original part number").fill(part);
    await page
      .getByLabel("Reason approval is unresolved")
      .fill(
        "Purchasing attribution awaiting review; synthetic browser fixture",
      );
    await page
      .getByRole("button", { name: "Create inspection", exact: true })
      .click();
    await page.waitForURL(/\/incoming\/[0-9a-f-]{36}$/);
    return page.url().split("/").at(-1)!;
  }
  test("inspector executes a standard multi-item form, preserves shared receiving and downloads the completed PDF", async ({
    page,
  }, testInfo) => {
    await inspectorLogin(page);
    const id = await newInspection(page, standardRevision, 2, "0001-SHOP-A.02");
    const receiving = page
      .locator("details")
      .filter({ has: page.locator("summary", { hasText: /receiving/i }) })
      .first();
    for (
      let i = 0;
      i <
      (await receiving
        .getByRole("button", { name: "Pass", exact: true })
        .count());
      i++
    )
      await receiving
        .getByRole("button", { name: "Pass", exact: true })
        .nth(i)
        .click();
    await page.getByLabel("This item's serial number").fill("UI-ITEM-001");
    await page.getByPlaceholder("0.000").first().fill("99.001");
    await page
      .getByLabel("Item disposition", { exact: true })
      .selectOption("PASS");
    await page.getByRole("tab", { name: "Item 2", exact: true }).click();
    await page.getByLabel("This item's serial number").fill("UI-ITEM-002");
    await page.getByPlaceholder("0.000").first().fill("99.002");
    await page
      .getByLabel("Item disposition", { exact: true })
      .selectOption("PASS");
    await page
      .getByRole("button", { name: "Complete inspection", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Save inspection", exact: true }),
    ).toBeHidden();
    const r = await (
      await page.request.get(`/api/v1/incoming-inspections/${id}`)
    ).json();
    expect(r.status).toBe("COMPLETE");
    expect(r.items.map((i: any) => i.serialNumber)).toEqual([
      "UI-ITEM-001",
      "UI-ITEM-002",
    ]);
    expect(r.sectionData.__shared.receiving).toHaveLength(5);
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Inspection PDF", exact: true })
      .click();
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
    await page.screenshot({
      path: testInfo.outputPath("standard-inspection.png"),
      fullPage: true,
    });
    await expect(
      page.getByRole("button", { name: "Reopen with reason", exact: true }),
    ).toBeHidden();
  });
  test("failed custom inspection leads to a linked NCR with narrative, scanned photo and captioned PDF", async ({
    page,
  }, testInfo) => {
    await inspectorLogin(page);
    await newInspection(page, customRevision, 1, "0001-CUSTOM-A.02");
    await page.getByLabel("This item's serial number").fill("UI-FAILED-001");
    await page
      .getByRole("button", { name: "Fail", exact: true })
      .first()
      .click();
    await page
      .getByPlaceholder("Description required…")
      .first()
      .fill("Surface gouge at mounting hole 2");
    await page
      .getByLabel("Attach inspection photo")
      .first()
      .setInputFiles({
        name: "surface-fixture.png",
        mimeType: "image/png",
        buffer: pixel,
      });
    await expect(
      page.getByText(/surface-fixture.png.*CLEAN/).first(),
    ).toBeVisible({ timeout: 60000 });
    await page
      .getByLabel("Item disposition", { exact: true })
      .selectOption("FAIL");
    await page
      .getByLabel("Disposition notes", { exact: true })
      .fill("Gouged mounting face requires Quality review");
    await page
      .getByRole("button", { name: "Complete inspection", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Save inspection", exact: true }),
    ).toBeHidden();
    await page
      .getByLabel("NCR title", { exact: true })
      .fill("Mounting face gouge from incoming inspection");
    await page
      .getByLabel("Defect classification", { exact: true })
      .selectOption("VISUAL");
    await page
      .getByRole("button", { name: "Save results & raise NCR", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Open linked NCR", exact: true })
      .click();
    await page.waitForURL(/\/quality\/ncrs\/[0-9a-f-]{36}$/);
    await expect(page.getByText("0001-CUSTOM-A.02 (unmapped)", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Add narrative section", exact: true })
      .click();
    await page
      .getByLabel("Report section title", { exact: true })
      .fill("Observed damage");
    await page
      .getByLabel("Report narrative", { exact: true })
      .fill("Gouge crosses the mounting face beside hole 2");
    await page
      .getByRole("button", { name: "Save report narrative", exact: true })
      .click();
    await page
      .getByLabel("New photo caption", { exact: true })
      .fill("Damage beside mounting hole 2");
    await page
      .getByLabel("Upload supporting photo", { exact: true })
      .setInputFiles({
        name: "ncr-fixture.png",
        mimeType: "image/png",
        buffer: pixel,
      });
    await expect(page.getByText(/ncr-fixture.png.*CLEAN/).first()).toBeVisible({
      timeout: 60000,
    });
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "NCR PDF", exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
    await page.screenshot({
      path: testInfo.outputPath("ncr-report.png"),
      fullPage: true,
    });
  });
  test("recorded injector sync, quick repair, automatic retest and comparison download work in the internal UI", async ({
    page,
  }, testInfo) => {
    await login(page, "admin");
    await page.goto("/injectors");
    const part = uniq("UI-INJ-");
    const before = benchReport({
      id: uniq("before-"),
      part,
      serial: "260521999A",
      datetime: "2026-06-29T16:00:00Z",
      flow: { IVM01: 250 },
    });
    await page.getByLabel("Find injector tests").fill(part);
    await page
      .getByText("Import a recorded CarbonZapp response", { exact: true })
      .click();
    await page
      .getByLabel("Recorded CarbonZapp reports")
      .setInputFiles({
        name: "before.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify([before])),
      });
    await page.getByRole("link", { name: "260521999A", exact: true }).click();
    await page.getByText(/Quick repair entry/).click();
    await page.getByLabel("Repair date", { exact: true }).fill("2026-06-29");
    await page
      .getByLabel("Armature Stroke before", { exact: true })
      .fill(".10");
    await page.getByLabel("Armature Stroke after", { exact: true }).fill(".12");
    await page
      .getByLabel("Armature Stroke unit", { exact: true })
      .selectOption("mm");
    await page
      .getByRole("button", { name: "Record measurements", exact: true })
      .click();
    const history = page.getByRole("link", {
      name: "Open repair history",
      exact: true,
    });
    await expect(history).toBeVisible();
    const href = (await history.getAttribute("href"))!;
    await page.goto("/injectors");
    await page.getByLabel("Find injector tests").fill(part);
    const after = benchReport({
      id: uniq("after-"),
      part,
      serial: "999",
      datetime: "2026-06-30T16:00:00Z",
    });
    await page
      .getByText("Import a recorded CarbonZapp response", { exact: true })
      .click();
    await page
      .getByLabel("Recorded CarbonZapp reports")
      .setInputFiles({
        name: "after.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify([after])),
      });
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(
                `/api/v1/injector-repairs/${href.split("/").at(-1)}`,
              )
            ).json()
          ).status,
      )
      .toBe("PASSED");
    await page
      .getByRole("checkbox", { name: "Select 999", exact: true })
      .check();
    await page
      .getByRole("checkbox", { name: "Select 260521999A", exact: true })
      .check();
    await page
      .getByLabel("Vendor / report heading", { exact: true })
      .fill("Synthetic browser acceptance");
    await page
      .getByRole("button", { name: "Preview comparison", exact: true })
      .click();
    await expect(
      page
        .locator("tr")
        .filter({ has: page.getByText("Peak HP", { exact: true }) }),
    ).toContainText(/250\s*FAIL/);
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Generate report", exact: true })
      .click();
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
    await page.screenshot({
      path: testInfo.outputPath("injector-comparison.png"),
      fullPage: true,
    });
  });
});
