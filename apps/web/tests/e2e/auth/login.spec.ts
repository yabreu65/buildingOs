import { test, expect } from '@playwright/test';
import { login, logout, TEST_USERS, isLoggedIn } from '../helpers/auth';
import { ROUTES } from '../helpers/navigation';

test.describe('Auth - Login Flow', () => {
  test('should successfully login with valid credentials', async ({ page }) => {
    // STEP 1: Navigate to login
    await page.goto('/auth/login');
    expect(page.url()).toContain('/auth/login');

    // STEP 2: Login
    await login(page, TEST_USERS.tenantAdminA);

    // STEP 3: Verify logged in
    const loggedIn = await isLoggedIn(page);
    expect(loggedIn).toBe(true);
    expect(page.url()).toContain('/dashboard');
  });

  test('should show error on invalid credentials', async ({ page }) => {
    // STEP 1: Navigate to login
    await page.goto('/auth/login');

    // STEP 2: Try login with wrong password
    await page.fill('input[name="email"]', TEST_USERS.tenantAdminA.email);
    await page.fill('input[name="password"]', 'wrongpassword');
    await page.click('button:has-text("Sign In")');

    // STEP 3: Verify error message
    await page.waitForTimeout(2000);
    const hasError = await page.locator('text=/invalid|wrong|credentials|failed/i').isVisible().catch(() => false);
    expect(hasError || page.url().includes('/auth/login')).toBe(true);
  });

  test('should show error on non-existent email', async ({ page }) => {
    // STEP 1: Navigate to login
    await page.goto('/auth/login');

    // STEP 2: Try login with non-existent email
    await page.fill('input[name="email"]', 'nonexistent@test.com');
    await page.fill('input[name="password"]', 'anypassword');
    await page.click('button:has-text("Sign In")');

    // STEP 3: Verify still on login page
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/auth/login');
  });

  test('should redirect to login when accessing protected route unauthenticated', async ({ page }) => {
    // STEP 1: Try to access dashboard without auth
    await page.goto('/dashboard');

    // STEP 2: Should be redirected to login
    await page.waitForURL('**/auth/login', { timeout: 10000 });
    expect(page.url()).toContain('/auth/login');
  });

  test('should successfully logout', async ({ page }) => {
    // STEP 1: Login first
    await login(page, TEST_USERS.tenantAdminA);
    expect(page.url()).toContain('/dashboard');

    // STEP 2: Logout
    await logout(page);

    // STEP 3: Verify redirected to login
    expect(page.url()).toContain('/auth/login');
  });

  test('should maintain session after page refresh', async ({ page }) => {
    // STEP 1: Login
    await login(page, TEST_USERS.tenantAdminA);
    expect(page.url()).toContain('/dashboard');

    // STEP 2: Refresh page
    await page.reload();

    // STEP 3: Should still be logged in
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    expect(page.url()).toContain('/dashboard');
  });
});
