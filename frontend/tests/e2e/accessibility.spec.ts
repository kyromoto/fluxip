import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * SC-008/FR-020 — WCAG 2.1 AA, audited per project (light/dark ×
 * mobile/desktop; see playwright.config.ts's `colorScheme` per project).
 *
 * Authenticated routes need a real session (tests/e2e/README.md); the
 * unauthenticated fallback is still checked unconditionally.
 */
const ROUTES = ["/", "/ip-clients", "/notifications", "/account"];

for (const route of ROUTES) {
  test(`WCAG 2.1 AA audit: ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForTimeout(300);

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
}
