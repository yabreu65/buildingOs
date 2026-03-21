import { Page, expect } from '@playwright/test';

/**
 * Utility functions for E2E tests
 */

/**
 * Wait for API response
 */
export async function waitForAPIResponse<T = Record<string, unknown>>(
  page: Page,
  urlPattern: string | RegExp,
  method = 'GET'
): Promise<T | null> {
  const response = await page.waitForResponse(
    (res) => {
      const matchesURL = typeof urlPattern === 'string'
        ? res.url().includes(urlPattern)
        : urlPattern.test(res.url());
      return matchesURL && res.request().method() === method;
    },
    { timeout: 10000 }
  );
  return response.json().catch(() => null) as Promise<T | null>;
}

/**
 * Verify element has specific text content
 */
export async function expectElementContainsText(
  page: Page,
  selector: string,
  text: string
): Promise<void> {
  const element = page.locator(selector).first();
  await expect(element).toContainText(text);
}

/**
 * Verify element is disabled
 */
export async function expectDisabled(page: Page, selector: string): Promise<void> {
  const element = page.locator(selector).first();
  await expect(element).toBeDisabled();
}

/**
 * Verify element is enabled
 */
export async function expectEnabled(page: Page, selector: string): Promise<void> {
  const element = page.locator(selector).first();
  await expect(element).toBeEnabled();
}

/**
 * Verify element is visible
 */
export async function expectVisible(page: Page, selector: string): Promise<void> {
  const element = page.locator(selector).first();
  await expect(element).toBeVisible();
}

/**
 * Verify element is hidden
 */
export async function expectHidden(page: Page, selector: string): Promise<void> {
  const element = page.locator(selector).first();
  await expect(element).toBeHidden();
}

/**
 * Wait for text to appear on page
 */
export async function waitForText(page: Page, text: string, timeout = 10000): Promise<void> {
  await page.locator(`text=${text}`).waitFor({ state: 'visible', timeout });
}

/**
 * Check if text exists on page
 */
export async function hasText(page: Page, text: string, timeout = 5000): Promise<boolean> {
  try {
    await page.locator(`text=${text}`).waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all text content from page
 */
export async function getPageText(page: Page): Promise<string> {
  return await page.locator('body').textContent() || '';
}

/**
 * Scroll to element
 */
export async function scrollToElement(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().scrollIntoViewIfNeeded();
}

/**
 * Type text slowly (for testing typing behavior)
 */
export async function typeSlowly(
  page: Page,
  selector: string,
  text: string,
  delayMs = 50
): Promise<void> {
  const element = page.locator(selector).first();
  await element.focus();
  for (const char of text) {
    await element.type(char, { delay: delayMs });
  }
}

/**
 * Take screenshot for debugging
 */
export async function screenshot(page: Page, name: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await page.screenshot({
    path: `test-results/${name}-${timestamp}.png`,
    fullPage: true,
  });
}

/**
 * Check for console errors
 */
export async function checkConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  return errors;
}

/**
 * Wait for network to be idle
 */
export async function waitForNetworkIdle(page: Page, timeout = 10000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout });
}

/**
 * Get LocalStorage item
 */
export async function getLocalStorage(page: Page, key: string): Promise<string | null> {
  return await page.evaluate((k) => localStorage.getItem(k), key);
}

/**
 * Set LocalStorage item
 */
export async function setLocalStorage(page: Page, key: string, value: string): Promise<void> {
  await page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: key, v: value });
}

/**
 * Clear LocalStorage
 */
export async function clearLocalStorage(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.clear());
}

/**
 * Generate unique test data
 */
export function generateTestData() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 9);

  return {
    timestamp,
    random,
    uniqueId: `test-${timestamp}-${random}`,
    email: `test-${timestamp}@buildingos.test`,
    name: `Test User ${timestamp}`,
    buildingName: `Building ${timestamp}`,
    unitLabel: `Unit-${random}`,
  };
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * Math.pow(2, i)));
    }
  }
  throw new Error('Retry failed');
}

/**
 * Wait and click (handles timing issues)
 */
export async function waitAndClick(page: Page, selector: string, timeout = 10000): Promise<void> {
  const element = page.locator(selector).first();
  await element.waitFor({ state: 'visible', timeout });
  await element.click();
}

/**
 * Fill and verify field value
 */
export async function fillAndVerify(
  page: Page,
  selector: string,
  value: string
): Promise<void> {
  await page.locator(selector).first().fill(value);
  // Verify the value was actually set
  await expect(page.locator(selector).first()).toHaveValue(value);
}

/**
 * Get element attribute
 */
export async function getAttribute(
  page: Page,
  selector: string,
  attribute: string
): Promise<string | null> {
  return await page.locator(selector).first().getAttribute(attribute);
}
