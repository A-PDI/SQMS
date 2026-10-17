import { expect, type Cookie, type Page } from "@playwright/test";
import { DEMO_PASSWORD, USERS, type UserKey } from "./api";

const sessionCookies = new Map<UserKey, Cookie[]>();

/**
 * Signs in through the login form the first time a user is needed, then reuses that browser session (the
 * login endpoint is rate limited, as it should be).
 */
export async function login(page: Page, user: UserKey) {
  if (!DEMO_PASSWORD) throw new Error("Set DEMO_USER_PASSWORD to the password used by the demo seed");
  const context = page.context();
  const cached = sessionCookies.get(user);
  if (cached) {
    await context.clearCookies();
    await context.addCookies(cached);
    await page.goto("/");
    if (!new URL(page.url()).pathname.startsWith("/login")) return;
    sessionCookies.delete(user);
  }
  await context.clearCookies();
  await page.goto("/login");
  await page.locator("#email").fill(USERS[user]);
  await page.locator("#password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  sessionCookies.set(user, await context.cookies());
}

/** Opens a search-as-you-type picker by its trigger text, searches and selects an option. */
export async function pick(page: Page, trigger: string | RegExp, search: string, option: string | RegExp) {
  await page.getByRole("button", { name: trigger, exact: typeof trigger === "string" }).first().click();
  await page.getByLabel("Search options").fill(search);
  await page.getByRole("option", { name: option }).first().click();
}

/** Opens an action dialog from a page button and confirms it, optionally filling the reason/comment field. */
export async function confirmAction(page: Page, open: string | RegExp, confirm: string | RegExp, reason?: { label: string | RegExp; text: string }) {
  await page.getByRole("button", { name: open }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  if (reason) await dialog.getByLabel(reason.label).fill(reason.text);
  await dialog.getByRole("button", { name: confirm, exact: typeof confirm === "string" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

/** The id at the end of the current URL (e.g. /projects/<id>). */
export function idFromUrl(page: Page): string {
  const id = new URL(page.url()).pathname.split("/").pop();
  if (!id) throw new Error(`No record id in ${page.url()}`);
  return id;
}
