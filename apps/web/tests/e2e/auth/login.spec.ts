import { test, expect } from '@playwright/test';
import { login, logout, TEST_USERS, isLoggedIn } from '../helpers/auth';

test.describe.serial('Auth - Login Flow', () => {
  test('should successfully login with valid credentials', async ({ page }) => {
    // STEP 1: Navigate to login
    await page.goto('/login');
    expect(page.url()).toContain('/login');

    // STEP 2: Login with test user
    await login(page, TEST_USERS.tenantAdminA);

    // STEP 3: Verify logged in
    const loggedIn = await isLoggedIn(page);
    expect(loggedIn).toBe(true);
    expect(page.url()).toContain('/dashboard');
  });

  test('should successfully logout', async ({ page }) => {
    // STEP 1: Login first
    await login(page, TEST_USERS.tenantAdminA);
    expect(page.url()).toContain('/dashboard');

    // STEP 2: Logout
    await logout(page);

    // STEP 3: Verify redirected to login
    expect(page.url()).toContain('/login');
  });

  test('should maintain session after page refresh', async ({ page }) => {
    // STEP 1: Login
    await login(page, TEST_USERS.tenantAdminA);
    expect(page.url()).toContain('/dashboard');

    // STEP 2: Refresh page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // STEP 3: Should still be logged in (not redirected to login)
    await page.waitForTimeout(3000);
    expect(page.url()).not.toContain('/login');
  });
});
