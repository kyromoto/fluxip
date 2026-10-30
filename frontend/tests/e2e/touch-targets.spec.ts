import { expect, test } from "@playwright/test";

/**
 * Constitution III.4 / FR-011 — every interactive element is at least
 * 44x44px below 768px. Needs a signed-in session (tests/e2e/README.md);
 * without one the app redirects to /login and the check is skipped.
 */
const ROUTES = ["/ip-clients", "/credentials", "/agents", "/notifications", "/account"];
const INTERACTIVE = 'a[href], button, [role="button"], [role="tab"], input:not([type="hidden"]), select';

for (const route of ROUTES) {
  test(`touch targets are at least 44x44px at ${route}`, async ({ page }) => {
    const viewport = page.viewportSize()!;
    test.skip(viewport.width >= 768, "touch target rule applies below 768px");

    await page.goto(route);
    await page.waitForTimeout(300);
    test.skip(page.url().includes("/login"), "needs a signed-in session");

    const undersized = await page.evaluate((selector) => {
      const result: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (el.closest(".sr-only") || getComputedStyle(el).position === "absolute" && rect.width <= 1) continue;
        // Kobalte's visually hidden native inputs are not the touch target.
        if (el instanceof HTMLInputElement && el.type === "checkbox") continue;
        if (rect.width < 43.5 || rect.height < 43.5) {
          result.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(rect.width)}x${Math.round(rect.height)}`);
        }
      }
      return result;
    }, INTERACTIVE);

    expect(undersized).toEqual([]);
  });
}
