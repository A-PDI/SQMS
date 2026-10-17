import { expect, test } from "@playwright/test";
import { login } from "./support/ui";

test("dashboard filters and supplier-table keyboard navigation retain their behavior", async ({
  page,
}) => {
  await login(page, "admin");
  const total = page.getByRole("button", { name: /Total Inspections/ });
  await total.click();
  await expect(page.getByRole("heading", { name: "All Inspections", exact: true })).toBeVisible();
  await total.click();
  await expect(page.getByRole("heading", { name: "All Inspections", exact: true })).toHaveCount(0);
  await page.goto("/suppliers");
  const table = page.getByRole("table", { name: "Suppliers", exact: true });
  await table
    .getByRole("button", { name: "Sort by Supplier", exact: true })
    .click();
  await expect(table.locator('th[aria-sort="ascending"]')).toHaveCount(1);
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("APPROVED");
  await page
    .getByRole("textbox", { name: "Search list", exact: true })
    .fill("Apex Turbo");
  await page
    .getByRole("textbox", { name: "Search list", exact: true })
    .press("Enter");
  await expect(table.getByRole("row")).toHaveCount(2);
  const record = table.getByRole("link", {
    name: "Apex Turbo Systems Inc.",
    exact: true,
  });
  await record.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/suppliers\/[0-9a-f-]{36}$/);
  await page.goBack();
  await expect(
    page.getByRole("textbox", { name: "Search list", exact: true }),
  ).toHaveValue("Apex Turbo");
  await expect(
    page.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveValue("APPROVED");
  await expect(table.locator('th[aria-sort="ascending"]')).toHaveCount(1);
  await expect(record).toBeVisible();
});

test.describe("Touch workspace", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("wide records remain readable and scrollable inside the mobile workspace", async ({
    page,
  }) => {
    await login(page, "admin");
    await page.goto("/suppliers");
    const region = page.getByRole("region", {
      name: "Suppliers table",
      exact: true,
    });
    await expect(
      region.getByRole("link", {
        name: "Apex Turbo Systems Inc.",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        "document.documentElement.scrollWidth <= window.innerWidth",
      ),
    ).toBe(true);
    await region.focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => region.evaluate(element => element.scrollLeft))
      .toBeGreaterThan(0);
    await page.getByRole("link", { name: "New supplier", exact: true }).click();
    await page.waitForURL("/suppliers/new");
    await expect(
      page.getByRole("textbox", { name: "Legal name", exact: true }),
    ).toBeVisible();
  });
});
