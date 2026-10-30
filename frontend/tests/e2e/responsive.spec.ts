import { expect, test } from "@playwright/test";

/**
 * SC-004/FR-016 — no horizontal scroll, no obscured controls, from the
 * 360px floor up through desktop. Runs on every configured project
 * (mobile-360-*, desktop-*); see playwright.config.ts.
 *
 * Authenticated routes need a real session (tests/e2e/README.md) — the
 * unauthenticated fallback is still a real screen this redesign covers and
 * is checked unconditionally.
 */
const ROUTES = ["/", "/ip-clients", "/credentials", "/agents", "/notifications", "/account"];

for (const route of ROUTES) {
  test(`no horizontal overflow at ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForTimeout(300);

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
}

/**
 * specs/011 FR-012 — the device wizard stays inside the viewport (no
 * horizontal scroll) and its footer actions are reachable and at least
 * 44px tall on mobile. Needs a signed-in session (tests/e2e/README.md).
 */
test("device wizard fits the viewport and keeps its actions reachable", async ({ page }) => {
  await page.goto("/ip-clients");
  await page.waitForTimeout(300);
  test.skip(page.url().includes("/login"), "needs a signed-in session");

  await page.getByRole("button", { name: /add.*device/i }).first().click();
  const next = page.getByRole("button", { name: "Next" });
  await expect(next).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);

  const viewport = page.viewportSize()!;
  for (const name of ["Cancel", "Next"]) {
    const box = (await page.getByRole("button", { name, exact: true }).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    if (viewport.width < 768) expect(box.height).toBeGreaterThanOrEqual(43.5);
  }
});
