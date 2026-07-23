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

/**
 * User Story 2 (004-credential-management spec.md) — a device whose account has zero
 * Hetzner credentials must never dead-end in the wizard; needs an authenticated session
 * AND a Trigger Device with no Provider Credentials configured yet (see tests/e2e/README.md).
 */
test("creates a credential inline from the wizard's empty state and resumes the Action", async ({ page }) => {
  await page.goto("/ip-clients");
  await page.getByRole("link").first().click();

  await page.getByRole("button", { name: /add.*action/i }).click();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText("Which DNS record should we update?")).toBeVisible();
  await expect(page.getByText(/don't have a Hetzner API Token yet/i)).toBeVisible();

  await page.getByRole("button", { name: "Add one now" }).click();
  await expect(page.getByText("Add a credential")).toBeVisible();
  await page.getByLabel("Name").fill("Hetzner Hauptaccount");
  await page.getByLabel("API token").fill("e2e-test-token-1234");
  await page.getByRole("button", { name: "Add credential" }).click();

  // Back on the same wizard step, with the new credential already selected — nothing lost.
  await expect(page.getByText("Which DNS record should we update?")).toBeVisible();
  await expect(page.getByRole("button", { name: /hetzner hauptaccount/i })).toBeVisible();

  await page.getByLabel("Hetzner zone ID").fill("zone-id-456");
  await page.getByLabel("Record name").fill("resumed.example.com");
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText("Which address(es) should this keep updated?")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText("Review")).toBeVisible();
  await page.getByRole("button", { name: "Attach action" }).click();

  await expect(page.getByText("resumed.example.com")).toBeVisible();
});
