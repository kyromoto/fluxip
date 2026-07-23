import { expect, test } from "@playwright/test";

/**
 * User Story 1 (spec.md) — requires an authenticated session; see tests/e2e/README.md.
 * Forces the onboarding gate open regardless of any prior run's state by
 * clearing the per-tenant localStorage flag before each test (research.md §2).
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("fluxip.onboarding.")) window.localStorage.removeItem(key);
    }
  });
});

test("shows a stepped onboarding flow with visible progress on first authenticated visit", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Welcome to FluxIP")).toBeVisible();
  await expect(page.getByText("Step 1 of 3")).toBeVisible();
});

test("going back preserves the notification addresses already entered", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Step 2 of 3")).toBeVisible();

  await page.getByLabel("Email address(es)").fill("me@example.com");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Step 3 of 3")).toBeVisible();

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Email address(es)")).toHaveValue("me@example.com");
});

test("completing the flow lands in the main app and does not re-show on reload", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Next" }).click(); // welcome -> notifications
  await page.getByRole("button", { name: "Next" }).click(); // notifications -> first device
  await page.getByRole("button", { name: "I'll do this later" }).click();
  await page.getByRole("button", { name: "Get started" }).click();

  await expect(page.getByText("Welcome to FluxIP")).not.toBeVisible();

  await page.reload();
  await expect(page.getByText("Welcome to FluxIP")).not.toBeVisible();
});
