import { type Page, expect } from '@playwright/test';

/**
 * Standard responsive viewports for finance E2E tests.
 * These match the breakpoints used in the BuildingOS Tailwind config.
 */
export const VIEWPORTS = {
  /** Mobile viewport — tests mobile-first finance views */
  mobile: { width: 390, height: 844 },
  /** Tablet viewport — tests tablet breakpoints */
  tablet: { width: 768, height: 1024 },
  /** Desktop viewport — contractual Journey F layout */
  desktop: { width: 1440, height: 900 },
  /** Wide desktop — tests wide-screen layout */
  wide: { width: 1920, height: 1080 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;

/**
 * Set the page viewport to a named preset.
 *
 * @example
 * ```ts
 * await setViewport(page, 'mobile');
 * ```
 */
export async function setViewport(page: Page, name: ViewportName): Promise<void> {
  await page.setViewportSize(VIEWPORTS[name]);
}

/**
 * Assert that the page itself does not have horizontal overflow.
 *
 * Internal table containers may scroll horizontally; this assertion only
 * rejects overflow at the document level.
 *
 * @param page - Playwright page
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

/**
 * Assert that a specific element is visible within the viewport.
 * Useful for verifying that finance cards/tables are not clipped.
 */
export async function expectVisibleInViewport(
  page: Page,
  selector: string,
): Promise<void> {
  const element = page.locator(selector).first();
  await expect(element).toBeVisible();

  const isInViewport = await element.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth
    );
  });

  expect(isInViewport).toBe(true);
}
