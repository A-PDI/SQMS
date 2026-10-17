import { expect, test } from "@playwright/test";
import { login } from "./support/ui";

test("grouped navigation crosses workflow and supplier pages with one active tab", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, "admin");
  let nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "Inspection", exact: true }).click();
  await nav.getByRole("link", { name: "New Inspection", exact: true }).click();
  await page.waitForURL("/inspections/new");
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(
    nav.getByRole("link", { name: "New Inspection", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.waitForURL("/");
  await nav.getByRole("button", { name: "Sourcing", exact: true }).click();
  await nav.getByRole("link", { name: "Suppliers", exact: true }).click();
  await page.waitForURL("/suppliers");
  await expect(
    page.getByRole("heading", { name: "Suppliers", exact: true }),
  ).toBeVisible();
  nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(
    nav.getByRole("link", { name: "Suppliers", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "User menu" }).click();
  await page
    .getByRole("menuitem", { name: "Change password", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Change Password", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Current Password", { exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await nav.getByRole("button", { name: "Inspection", exact: true }).click();
  await nav.getByRole("link", { name: "Inspections", exact: true }).click();
  await page.waitForURL("/inspections");
  await expect(
    page.getByRole("heading", { name: "Inspections", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await page.waitForURL("/suppliers");
  await expect(
    page.getByRole("heading", { name: "Suppliers", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile navigation supports keyboard dismissal, route changes and desktop resize", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "admin");
  const trigger = page.getByRole("button", { name: "Open navigation" });
  await trigger.click();
  const drawer = page.getByRole("dialog", {
    name: "Main navigation",
    exact: true,
  });
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  const nav = drawer.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "Inspection", exact: true }).click();
  await nav.getByRole("link", { name: "Inspections", exact: true }).click();
  await page.waitForURL("/inspections");
  await expect(drawer).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Inspections", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"),
  ).toBe(true);
  await trigger.click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(drawer).toBeHidden();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Dashboard", exact: true })
    .click();
  await page.waitForURL("/");
});

test("read-only navigation hides creation and administration while retaining permitted pages", async ({
  page,
}) => {
  await login(page, "readOnly");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(
    nav.getByRole("button", { name: "Administration", exact: true }),
  ).toHaveCount(0);
  await nav.getByRole("button", { name: "Inspection", exact: true }).click();
  await expect(
    nav.getByRole("link", { name: "New Inspection", exact: true }),
  ).toHaveCount(0);
  await expect(
    nav.getByRole("link", { name: "Forms & catalogue", exact: true }),
  ).toHaveCount(0);
  await expect(
    nav.getByRole("link", { name: "Inspections", exact: true }),
  ).toBeVisible();
  await nav.getByRole("button", { name: "Sourcing", exact: true }).click();
  await nav.getByRole("link", { name: "Suppliers", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Suppliers", exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Global search" }).fill("turbo");
  await page.getByRole("textbox", { name: "Global search" }).press("Enter");
  await page.waitForURL(/\/search\?q=turbo$/);
});
