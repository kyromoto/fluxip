import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * Two projects per research.md §6: a 360px floor (FR-016/SC-004) and a
 * large-desktop width, each run under both a forced-light and forced-dark
 * emulated color scheme (FR-003/FR-004/SC-005, SC-008).
 *
 * Registration/login is Logto-hosted (research.md §1), so authenticated
 * scenarios follow Playwright's standard pattern for OIDC-gated apps: a
 * one-time manual sign-in produces `playwright/.auth/user.json`, which every
 * project then reuses. This repo does NOT generate that file automatically —
 * running an automated sign-up against a real Logto tenant isn't something
 * a test run should do. See tests/e2e/README.md.
 */
const AUTH_STATE_PATH = "playwright/.auth/user.json";
const storageState = existsSync(AUTH_STATE_PATH) ? AUTH_STATE_PATH : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    storageState,
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: "mobile-360-light",
      use: { viewport: { width: 360, height: 800 }, colorScheme: "light" },
    },
    {
      name: "mobile-360-dark",
      use: { viewport: { width: 360, height: 800 }, colorScheme: "dark" },
    },
    {
      name: "desktop-light",
      use: { ...devices["Desktop Chrome"], colorScheme: "light" },
    },
    {
      name: "desktop-dark",
      use: { ...devices["Desktop Chrome"], colorScheme: "dark" },
    },
  ],
});
