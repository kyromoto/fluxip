import { expect, test } from "@playwright/test";

/**
 * User Story 3 (spec.md) — requires an authenticated session AND an existing
 * Trigger Device with at least one Provider Credential; see tests/e2e/README.md.
 */
test("configures a DNS-update Action end-to-end via the guided flow", async ({ page }) => {
  await page.goto("/ip-clients");
  await page.getByRole("link").first().click(); // open the first device's Actions page

  await page.getByRole("button", { name: /add.*action/i }).click();
  await expect(page.getByText("What should happen when the IP changes?")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText("Which DNS record should we update?")).toBeVisible();
  await page.getByRole("button", { name: /select a credential/i }).click();
  await page.getByRole("option").first().click();
  await page.getByLabel("Hetzner zone ID").fill("zone-id-123");
  await page.getByLabel("Record name").fill("home.example.com");
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText("Which address(es) should this keep updated?")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText("Review")).toBeVisible();
  await page.getByRole("button", { name: "Attach action" }).click();

  await expect(page.getByText("home.example.com")).toBeVisible();
});
