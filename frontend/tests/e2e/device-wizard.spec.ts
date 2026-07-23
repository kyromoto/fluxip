import { expect, test } from "@playwright/test";

/**
 * User Story 2 (spec.md) — requires an authenticated session; see tests/e2e/README.md.
 */
test("creates a Trigger Device end-to-end via the guided flow", async ({ page }) => {
  await page.goto("/ip-clients");

  await page.getByRole("button", { name: /add.*device/i }).first().click();
  await expect(page.getByText("Name your device")).toBeVisible();

  const label = `Test Device ${Date.now()}`;
  await page.getByLabel("Label").fill(label);
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText(`Ready to create "${label}"?`)).toBeVisible();
  await page.getByRole("button", { name: "Create device" }).click();

  await expect(page.getByText("Save these now")).toBeVisible();
  await page.getByRole("button", { name: "Done, I've saved it" }).click();

  await expect(page.getByText(label)).toBeVisible();
});

test("abandoning the flow before confirming leaves no device behind", async ({ page }) => {
  await page.goto("/ip-clients");

  const label = `Abandoned Device ${Date.now()}`;
  await page.getByRole("button", { name: /add.*device/i }).first().click();
  await page.getByLabel("Label").fill(label);
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.reload();
  await expect(page.getByText(label)).not.toBeVisible();
});
