import { Page, expect } from '@playwright/test';

/**
 * Helper functions for authentication flows
 */

export interface TestUser {
  email: string;
  password: string;
  fullName?: string;
}

/**
 * Test users loaded from environment variables
 * Must be set in playwright environment or .env.test file
 * Fallbacks to process.env only - no hardcoded values
 */
function getTestUser(
  emailEnv: string,
  passwordEnv: string,
  fullName: string
): TestUser {
  const email = process.env[emailEnv];
  const password = process.env[passwordEnv];

  if (!email || !password) {
    throw new Error(
      `Missing test credentials: ${emailEnv} and/or ${passwordEnv}. ` +
      `Set them in .env.test or as environment variables.`
    );
  }

  return { email, password, fullName };
}

export const TEST_USERS = {
  superAdmin: getTestUser('TEST_SUPER_ADMIN_EMAIL', 'TEST_SUPER_ADMIN_PASSWORD', 'Super Admin'),
  tenantAdminA: getTestUser('TEST_TENANT_ADMIN_EMAIL', 'TEST_TENANT_ADMIN_PASSWORD', 'Admin Tenant A'),
  tenantAdminB: getTestUser('TEST_TENANT_ADMIN_B_EMAIL', 'TEST_TENANT_ADMIN_PASSWORD', 'Admin Tenant B'),
  operator: getTestUser('TEST_OPERATOR_EMAIL', 'TEST_OPERATOR_PASSWORD', 'Operator User'),
  resident: getTestUser('TEST_RESIDENT_EMAIL', 'TEST_RESIDENT_PASSWORD', 'Resident User'),
  residentB: getTestUser('TEST_RESIDENT_B_EMAIL', 'TEST_RESIDENT_PASSWORD', 'Resident B'),
};

/**
 * Login to BuildingOS
 */
export async function login(page: Page, user: TestUser): Promise<void> {
  await page.goto('/auth/login');
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="password"]', user.password);
  await page.click('button:has-text("Sign In")');

  // Wait for redirect to dashboard
  await page.waitForURL('**/dashboard', { timeout: 10000 });
  await expect(page).toHaveURL(/.*dashboard/);
}

/**
 * Sign up a new user
 */
export async function signup(page: Page, user: TestUser & { tenantName: string }): Promise<void> {
  await page.goto('/auth/signup');

  // Fill signup form
  await page.fill('input[name="fullName"]', user.fullName || 'Test User');
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="tenantName"]', user.tenantName);
  await page.fill('input[name="password"]', user.password);

  // Submit
  await page.click('button:has-text("Create Account")');

  // Wait for redirect to dashboard
  await page.waitForURL('**/dashboard', { timeout: 10000 });
  await expect(page).toHaveURL(/.*dashboard/);
}

/**
 * Logout from BuildingOS
 */
export async function logout(page: Page): Promise<void> {
  await page.click('button[aria-label="User menu"], [data-testid="user-menu"]');
  await page.click('button:has-text("Sign Out"), a:has-text("Logout")');
  await page.waitForURL('/auth/login', { timeout: 10000 });
  await expect(page).toHaveURL(/.*auth\/login/);
}

/**
 * Get current user info from page (if displayed)
 */
export async function getCurrentUser(page: Page): Promise<string | null> {
  try {
    const userElement = await page.locator('[data-testid="current-user"], .user-name').first();
    if (await userElement.isVisible()) {
      return await userElement.textContent();
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Verify user is logged in by checking for dashboard elements
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.waitForURL('**/dashboard', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
