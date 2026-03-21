import { Page, expect } from '@playwright/test';

/**
 * Helper functions for navigation and page interactions
 */

export const ROUTES = {
  dashboard: '/dashboard',
  buildings: '/buildings',
  buildingCreate: '/buildings/create',
  units: (buildingId: string) => `/buildings/${buildingId}/units`,
  unitCreate: (buildingId: string) => `/buildings/${buildingId}/units/create`,
  finance: '/finance',
  chargesCreate: '/finance/charges/create',
  payments: '/finance/payments',
  tickets: '/tickets',
  ticketsCreate: '/tickets/create',
  communications: '/communications',
  documents: '/documents',
  vendors: '/vendors',
  workOrders: '/vendors/work-orders',
  members: '/settings/members',
  memberInvite: '/settings/members/invite',
  tenants: '/super-admin/tenants',
  aiAnalytics: '/super-admin/ai-analytics',
} as const;

/**
 * Navigate to a route and wait for it to load
 */
export async function navigateTo(page: Page, route: string): Promise<void> {
  await page.goto(route);
  // Wait for navigation to complete
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
}

/**
 * Click a navigation link in the sidebar
 */
export async function clickNavLink(page: Page, linkText: string): Promise<void> {
  // Try multiple selectors for robustness
  const selectors = [
    `nav a:has-text("${linkText}")`,
    `[data-testid="nav-${linkText.toLowerCase().replace(/\s+/g, '-')}"]`,
    `sidebar a:has-text("${linkText}")`,
  ];

  let clicked = false;
  for (const selector of selectors) {
    const element = page.locator(selector).first();
    if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
      await element.click();
      clicked = true;
      break;
    }
  }

  if (!clicked) {
    throw new Error(`Could not find navigation link: ${linkText}`);
  }

  // Wait for navigation
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
}

/**
 * Check if we're on a specific route
 */
export async function isOnRoute(page: Page, route: string): Promise<boolean> {
  return page.url().includes(route);
}

/**
 * Wait for a specific element to be visible
 */
export async function waitForElement(page: Page, selector: string, timeout = 10000): Promise<void> {
  await page.locator(selector).first().waitFor({ state: 'visible', timeout });
}

/**
 * Click a button by text (case-insensitive)
 */
export async function clickButton(page: Page, buttonText: string): Promise<void> {
  await page.click(`button:has-text("${buttonText}"), [role="button"]:has-text("${buttonText}")`);
}

/**
 * Fill a form field by name or placeholder
 */
export async function fillField(page: Page, fieldName: string, value: string): Promise<void> {
  const selectors = [
    `input[name="${fieldName}"]`,
    `textarea[name="${fieldName}"]`,
    `input[placeholder="${fieldName}"]`,
    `select[name="${fieldName}"]`,
  ];

  for (const selector of selectors) {
    const element = page.locator(selector).first();
    if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
      if (selector.includes('select')) {
        // For select elements, use selectOption
        await element.selectOption(value);
      } else {
        await element.fill(value);
      }
      return;
    }
  }

  throw new Error(`Could not find field: ${fieldName}`);
}

/**
 * Check if an error message is visible
 */
export async function hasError(page: Page, errorText: string): Promise<boolean> {
  try {
    await page.locator(`text=${errorText}`).waitFor({ state: 'visible', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a success message is visible
 */
export async function hasSuccess(page: Page, successText: string): Promise<boolean> {
  try {
    await page.locator(`text=${successText}`).waitFor({ state: 'visible', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get text content of an element
 */
export async function getText(page: Page, selector: string): Promise<string | null> {
  try {
    return await page.locator(selector).first().textContent();
  } catch {
    return null;
  }
}
