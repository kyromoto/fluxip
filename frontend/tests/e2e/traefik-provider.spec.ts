import { expect, test } from "@playwright/test";

/**
 * 008-traefik-provider-config — requires an authenticated session AND at least one device and
 * BACKEND_AGENT_PUBLIC_URL configured on the backend; see tests/e2e/README.md.
 */
test("creates an agent, then delivers a device to it through an action", async ({ page }) => {
  const name = `E2E ${Date.now()}`;

  await page.goto("/agents");
  await page.getByRole("button", { name: /add (an|your first) agent/i }).first().click();
  await page.getByPlaceholder("e.g. Office Berlin").fill(name);
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByRole("button", { name: /FluxIP connects to the agent/ })).toBeDisabled();
  await expect(page.getByText("Not yet available")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Create agent" }).click();

  await expect(page.getByTestId("agent-token")).toContainText("fxt_");
  await expect(page.getByText(/fluxip-agent run/)).toBeVisible();
  await page.getByRole("button", { name: "I have saved the token" }).click();
  await expect(page.getByText(name)).toBeVisible();

  await page.goto("/ip-clients");
  await page.getByRole("link").first().click();
  await page.getByRole("button", { name: /add.*action/i }).click();
  await page.getByRole("button", { name: /Traefik configuration/ }).click();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText("Which Traefik should get this device's address?")).toBeVisible();
  await page.getByRole("button", { name: /select an agent/i }).click();
  await page.getByRole("option", { name }).click();
  await page.getByPlaceholder("e.g. admin-allowlist").fill("admin-allowlist");
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText(/IPv4 and IPv6 alike/)).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Attach action" }).click();

  await expect(page.getByText("admin-allowlist")).toBeVisible();
  // No agent is connected in this scenario, so the delivery status says so.
  await expect(page.getByText("Agent disconnected")).toBeVisible();
});
