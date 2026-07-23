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
const ROUTES = ["/", "/ip-clients", "/notifications", "/account"];

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
