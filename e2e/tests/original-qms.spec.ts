import {
  expect,
  test,
  request,
  type APIRequestContext,
} from "@playwright/test";
const password = process.env.DEMO_USER_PASSWORD || "";
const part = `QMS-PARITY-${Date.now()}`;
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);

test.describe.serial("Original QMS workflows on SQMS", () => {
  let api: APIRequestContext,
    csrf = "",
    templateId = "",
    inspectionId = "";
  test.beforeAll(async () => {
    if (!password)
      throw new Error(
        "Set DEMO_USER_PASSWORD for the explicitly seeded test stack",
      );
    api = await request.newContext({
      baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    });
    const login = await api.post("/api/v1/auth/login", {
      data: { email: "admin@demo.sqms.example", password },
    });
    expect(login.ok()).toBe(true);
    csrf = (await login.json()).csrfToken;
    const response = await api.post("/api/v1/qms/admin/templates", {
      headers: { "X-CSRF-Token": csrf },
      data: {
        form_no: part,
        title: "Original visual inspection",
        component_type: "custom",
        header_schema: [],
        disposition_type: "pass_fail",
        sections: {
          visual: {
            title: "Visual Inspection",
            section_type: "pfn_visual",
            items: [
              {
                id: 1,
                ctq_area: "Surface",
                failure_mode: "Damage",
                criteria: "No damage",
                method: "Visual",
              },
            ],
          },
        },
      },
    });
    expect(response.ok()).toBe(true);
    templateId = (await response.json()).template.id;
    expect(
      (
        await api.post("/api/v1/qms/part-specs", {
          headers: { "X-CSRF-Token": csrf },
          data: {
            template_id: templateId,
            part_number: part,
            description: "Original catalogue lookup",
            spec_data: {},
          },
        })
      ).ok(),
    ).toBe(true);
  });
  test.afterAll(async () => api?.dispose());
  async function login(page: any) {
    await page.goto("/login");
    await page.getByPlaceholder("you@pdi.com").fill("admin@demo.sqms.example");
    await page.locator("input[type=password]").fill(password);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await page.waitForURL("/");
  }
  test("creates from the original modal, records an item, completes, reloads and generates its PDF", async ({
    page,
  }) => {
    await login(page);
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Inspection", exact: true })
      .click();
    await page
      .getByRole("link", { name: "New Inspection", exact: true })
      .click();
    await page.getByPlaceholder("Type or select a part number…").fill(part);
    await page
      .getByRole("listbox")
      .getByRole("option")
      .filter({ hasText: part })
      .click();
    await expect(page.locator("#field-part_type")).toHaveValue(templateId);
    await page.locator("#field-po_number").fill("PO-ORIGINAL-UI");
    await page.locator("#field-date_received").fill("2026-10-17");
    await page
      .getByRole("button", { name: "Start Inspection", exact: true })
      .click();
    await page.waitForURL(/\/inspections\/[^/]+\/edit$/);
    inspectionId = new URL(page.url()).pathname.split("/")[2];
    await page
      .getByPlaceholder("Serial number of the part being inspected…")
      .fill("SERIAL-ORIGINAL-001");
    await page
      .getByRole("button", { name: "Pass", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "PASS", exact: true }).click();
    await page
      .getByRole("button", { name: "Complete Inspection", exact: true })
      .last()
      .click();
    await page.waitForURL(`/inspections/${inspectionId}`);
    await page.reload();
    await expect(
      page.getByText("SERIAL-ORIGINAL-001", { exact: false }).first(),
    ).toBeVisible();
    const record = await (
      await api.get(`/api/v1/qms/inspections/${inspectionId}`)
    ).json();
    expect(record.inspection.status).toBe("complete");
    expect(record.inspection.section_data.__items[0].__serial_no).toBe(
      "SERIAL-ORIGINAL-001",
    );
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "PDF", exact: true }).click();
    expect((await download).suggestedFilename()).toContain(part);
  });
  test("saves original NCR narrative and captioned photos and keeps them after reload", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/ncrs/new");
    const fields = page.locator("#page-content input[type=text]");
    await fields.nth(0).fill(part);
    await page
      .getByPlaceholder("Describe the non-conformance in detail…")
      .fill("Original report editor integration check");
    await page
      .getByRole("button", { name: "Add Section", exact: true })
      .click();
    await page.getByPlaceholder("e.g. Root Cause").fill("Investigation");
    await page
      .getByPlaceholder("Enter the details for this section…")
      .fill("Original narrative retained verbatim.");
    await page.locator("input[type=file]").last().setInputFiles({
      name: "evidence.png",
      mimeType: "image/png",
      buffer: pixel,
    });
    await page
      .getByRole("textbox", { name: "Caption for photo 1", exact: true })
      .fill("Original caption");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForURL(/\/ncrs\/[0-9a-f-]{36}$/);
    await expect(
      page.getByText("Original caption", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("Original narrative retained verbatim.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Original caption", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".ncr-report img").last()).toBeVisible();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/suppliers");
    await expect(
      page.getByRole("heading", { name: "Suppliers", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /sign out|log out/i }).click();
    await page.waitForURL("/login");
    await expect(page.getByPlaceholder("you@pdi.com")).toBeVisible();
    expect(errors).toEqual([]);
  });
});
