import { expect, test } from "@playwright/test";

/**
 * Constitution III.3 — the primary action sits top right on desktop and is a
 * bottom-anchored floating button below 768px. Needs a signed-in session
 * (tests/e2e/README.md); without one the app redirects to /login and the
 * check is skipped.
 */
const PAGES = [
  { route: "/ip-clients", name: /add a device/i },
  { route: "/credentials", name: /add credential/i },
  { route: "/agents", name: /add an agent/i },
];

for (const { route, name } of PAGES) {
  test(`primary action placement at ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForTimeout(300);
    test.skip(page.url().includes("/login"), "needs a signed-in session");

    const button = page.getByRole("button", { name }).first();
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    const viewport = page.viewportSize()!;

    if (viewport.width >= 768) {
      const main = (await page.locator("main > div").first().boundingBox())!;
      expect(box.x + box.width).toBeGreaterThan(main.x + main.width - 40);
      expect(box.y).toBeLessThan(main.y + 120);
    } else {
      expect(box.y + box.height).toBeGreaterThan(viewport.height - 100);
      expect(box.x + box.width).toBeGreaterThan(viewport.width - 40);

      await page.evaluate(() => document.querySelector("main")?.scrollTo(0, 99999));
      const after = (await button.boundingBox())!;
      expect(after.y).toBe(box.y);
    }
  });
}
