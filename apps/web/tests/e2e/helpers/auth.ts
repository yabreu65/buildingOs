import { Page, expect } from '@playwright/test';

/**
 * Test users - Hardcoded deterministic credentials from seed.test.ts
 * These match the users created by `npm run seed:test` in the API
 */

export interface TestUser {
  readonly email: string;
  readonly password: string;
  readonly fullName?: string;
}

const TEST_PASSWORD = process.env.TEST_E2E_PASSWORD || 'TestPass123!';

export const TEST_USERS = {
  superAdmin: { email: 'test-superadmin@buildingos.local', password: TEST_PASSWORD, fullName: 'Test Super Admin' },
  tenantAdminA: { email: 'test-tenant-admin-a@buildingos.local', password: TEST_PASSWORD, fullName: 'Test Admin A' },
  tenantAdminB: { email: 'test-tenant-admin-b@buildingos.local', password: TEST_PASSWORD, fullName: 'Test Admin B' },
  operator: { email: 'test-operator@buildingos.local', password: TEST_PASSWORD, fullName: 'Test Operator' },
  resident: { email: 'test-resident@buildingos.local', password: TEST_PASSWORD, fullName: 'Test Resident' },
  residentB: { email: 'test-resident-b@buildingos.local', password: TEST_PASSWORD, fullName: 'Test Resident B' },
} as const satisfies Record<string, TestUser>;

/**
 * Login to BuildingOS
 * Uses data-testid selectors for stability
 * Returns the tenantId from the post-login URL
 */
export async function login(page: Page, user: TestUser): Promise<string> {
  await page.goto('/login');
  await page.fill('[data-testid="login-email"]', user.email);
  await page.fill('[data-testid="login-password"]', user.password);
  await page.getByRole('button', { name: /iniciar sesión/i }).click();

  // Wait for navigation away from login page (goes to /:tenantId/dashboard)
  try {
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20000 });
  } catch (error) {
    const visibleError = await page
      .locator('[role="alert"], [data-testid="login-error"], .text-red-700, .text-red-600')
      .first()
      .textContent()
      .catch(() => null);

    throw new Error(
      visibleError
        ? `Login did not navigate away from /login: ${visibleError.trim()}`
        : `Login did not navigate away from /login: ${(error as Error).message}`,
    );
  }

  // Extract tenantId from URL like /:tenantId/dashboard
  const url = new URL(page.url());
  const tenantId = url.pathname.split('/')[1];
  if (!tenantId || tenantId === 'login') {
    throw new Error('Failed to extract tenantId after login');
  }
  return tenantId;
}

/**
 * Logout from BuildingOS
 */
export async function logout(page: Page): Promise<void> {
  const logoutButton = page.locator('button:has-text("Cerrar sesión"), button:has-text("Logout")').first();
  await logoutButton.click();
  await page.waitForURL('/login', { timeout: 10000 });
  await expect(page).toHaveURL(/.*login/);
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
