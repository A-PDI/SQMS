import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end demos against a running SQMS stack with the fictional demo data loaded:
 *   E2E_BASE_URL (default http://localhost:3000) and DEMO_USER_PASSWORD (the demo seed password).
 * The flows are long business processes, so tests in a file run serially and share state.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 10 * 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
