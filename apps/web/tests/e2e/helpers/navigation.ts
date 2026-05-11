import { Page, expect } from '@playwright/test';

/**
 * Helper functions for navigation and page interactions
 * Updated to match Spanish UI and data-testid selectors
 */

export const ROUTES = {
  dashboard: '/dashboard',
  buildings: (tenantId: string) => `/${tenantId}/buildings`,
  buildingCreate: (tenantId: string) => `/${tenantId}/buildings`,
  units: (tenantId: string, buildingId: string) => `/${tenantId}/buildings/${buildingId}`,
  finance: (tenantId: string) => `/${tenantId}/finanzas`,
  tickets: (tenantId: string) => `/${tenantId}/tickets`,
  communications: (tenantId: string) => `/${tenantId}/communications`,
  documents: (tenantId: string) => `/${tenantId}/documents`,
  members: (tenantId: string) => `/${tenantId}/settings/members`,
  tenants: '/super-admin/tenants',
};

/**
 * Navigate to a route and wait for it to load
 */
export async function navigateTo(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
}

/**
 * Click a navigation link in the sidebar by text
 * Uses text matching for Spanish labels
 */
export async function clickNavLink(page: Page, linkText: string): Promise<void> {
  const selectors = [
    `nav a:has-text("${linkText}")`,
    `[data-testid="nav-${linkText.toLowerCase().replace(/\s+/g, '-')}"]`,
    `aside a:has-text("${linkText}")`,
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

  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
}

/**
 * Click a button by text (case-insensitive, Spanish)
 */
export async function clickButton(page: Page, buttonText: string): Promise<void> {
  const selectors = [
    `button:has-text("${buttonText}")`,
    `[role="button"]:has-text("${buttonText}")`,
    `[data-testid*="${buttonText.toLowerCase().replace(/\s+/g, '-')}"]`,
  ];

  for (const selector of selectors) {
    const element = page.locator(selector).first();
    if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
      await element.click();
      return;
    }
  }

  throw new Error(`Could not find button: ${buttonText}`);
}

/**
 * Fill a form field by data-testid or name
 */
export async function fillField(page: Page, fieldName: string, value: string): Promise<void> {
  const selectors = [
    `[data-testid="${fieldName}-input"]`,
    `[data-testid="${fieldName}"]`,
    `input[name="${fieldName}"]`,
    `textarea[name="${fieldName}"]`,
    `input[placeholder="${fieldName}"]`,
    `select[name="${fieldName}"]`,
  ];

  for (const selector of selectors) {
    const element = page.locator(selector).first();
    if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
      if (selector.includes('select')) {
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
