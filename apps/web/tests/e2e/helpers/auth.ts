import { Page, expect, type Response } from '@playwright/test';

/**
 * Test users - Hardcoded deterministic credentials from seed.test.ts
 * These match the users created by `npm run seed:test` in the API
 */

export interface TestUser {
  readonly email: string;
  readonly password: string;
  readonly fullName?: string;
}

const TEST_PASSWORD = process.env.TEST_E2E_PASSWORD;
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL?.trim() || 'http://localhost:4000';
const AUTH_LOGIN_ENDPOINT = '/auth/login';
const AUTH_SESSION_ENDPOINT = '/auth/me';
const AUTH_COOKIE_NAMES = ['bo_access_token', 'bo_refresh_token'] as const;

if (!TEST_PASSWORD) {
  throw new Error('TEST_E2E_PASSWORD is required for E2E auth tests');
}

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
  const loginUrl = new URL(AUTH_LOGIN_ENDPOINT, API_ORIGIN).toString();
  const sessionUrl = new URL(AUTH_SESSION_ENDPOINT, API_ORIGIN).toString();

  const waitForLoginResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url() === loginUrl,
    { timeout: 20000 },
  );

  await page.goto('/login');
  await page.fill('[data-testid="login-email"]', user.email);
  await page.fill('[data-testid="login-password"]', user.password);
  await page.getByRole('button', { name: /iniciar sesión/i }).click();

  const loginResponse = await waitForLoginResponse.catch(async (error: unknown) => {
    const endpoint = AUTH_LOGIN_ENDPOINT;
    const publicError = await getPublicErrorMessage(page);
    throw new Error(
      `AUTH_LOGIN_TIMEOUT endpoint=${endpoint} finalUrl=${page.url()} message=${publicError ?? getErrorMessage(error)}`,
    );
  });

  if (!loginResponse.ok()) {
    const publicError = await getResponseMessage(loginResponse);
    throw new Error(
      `AUTH_LOGIN_FAILED status=${loginResponse.status()} endpoint=${AUTH_LOGIN_ENDPOINT} message=${publicError} finalUrl=${page.url()}`,
    );
  }

  const authCookieNames = await getAuthCookieNames(page);
  if (authCookieNames.length !== AUTH_COOKIE_NAMES.length) {
    throw new Error(
      `AUTH_COOKIE_MISSING status=${loginResponse.status()} endpoint=${AUTH_LOGIN_ENDPOINT} cookies=${authCookieNames.join(',') || 'none'} finalUrl=${page.url()}`,
    );
  }

  // Wait for navigation away from login page (goes to /:tenantId/dashboard)
  try {
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20000 });
  } catch (error) {
    throw new Error(
      `AUTH_NAVIGATION_TIMEOUT status=${loginResponse.status()} endpoint=${AUTH_LOGIN_ENDPOINT} cookies=${authCookieNames.join(',') || 'none'} finalUrl=${page.url()} message=${getErrorMessage(error)}`,
    );
  }

  const sessionProbe = await page.evaluate(async (targetUrl) => {
    try {
      const response = await fetch(targetUrl, {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
        },
      });

      return {
        ok: response.ok,
        status: response.status,
        text: await response.text(),
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        text: error instanceof Error ? error.message : String(error),
      };
    }
  }, sessionUrl);

  if (!sessionProbe.ok) {
    throw new Error(
      `AUTH_SESSION_FAILED status=${sessionProbe.status} endpoint=${AUTH_SESSION_ENDPOINT} cookies=${authCookieNames.join(',') || 'none'} finalUrl=${page.url()} message=${sanitizeText(sessionProbe.text)}`,
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

async function getAuthCookieNames(page: Page): Promise<string[]> {
  const cookies = await page.context().cookies([API_ORIGIN]);
  const cookieNames = new Set(cookies.map((cookie) => cookie.name));
  return AUTH_COOKIE_NAMES.filter((cookieName) => cookieNames.has(cookieName));
}

async function getPublicErrorMessage(page: Page): Promise<string | null> {
  const visibleError = await page
    .locator('[role="alert"], [data-testid="login-error"], .text-red-700, .text-red-600')
    .first()
    .textContent()
    .catch(() => null);

  return visibleError ? sanitizeText(visibleError) : null;
}

async function getResponseMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return sanitizeText(text) || response.statusText() || 'No public error message available';
  } catch {
    return response.statusText() || 'No public error message available';
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? sanitizeText(error.message) : sanitizeText(String(error));
}

function sanitizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
