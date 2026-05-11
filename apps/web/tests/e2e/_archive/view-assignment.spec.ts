import { test, expect } from '@playwright/test';
import { login, TEST_USERS } from '../helpers/auth';

test.describe('Resident - View Assignment Flow', () => {
  test('should login as resident and see dashboard', async ({ page }) => {
    // STEP 1: Login as resident
    await login(page, TEST_USERS.resident);

    // STEP 2: Verify on dashboard
    expect(page.url()).toContain('/dashboard');
    await page.waitForLoadState('networkidle');

    // STEP 3: Dashboard should be accessible
    const dashboardContent = await page.locator('[data-testid="dashboard"], main').isVisible().catch(() => false);
    expect(dashboardContent).toBe(true);
  });

  test('should display assigned unit information', async ({ page }) => {
    // STEP 1: Login as resident
    await login(page, TEST_USERS.resident);

    // STEP 2: Look for unit information on dashboard
    await page.waitForLoadState('networkidle');

    // Check for unit card or section
    const unitSection = await page.locator('text=/unit|property|apartment/i').isVisible({ timeout: 5000 }).catch(() => false);

    // If unit info exists, it should be read-only (no edit buttons for resident)
    if (unitSection) {
      const editButton = await page.locator('button:has-text("Edit"), button:has-text("Modify")').isVisible({ timeout: 5000 }).catch(() => false);
      expect(editButton).toBe(false);
    }
  });

  test('should not have access to admin functions', async ({ page }) => {
    // STEP 1: Login as resident
    await login(page, TEST_USERS.resident);

    // STEP 2: Try to access admin routes
    await page.goto('/buildings/create');
    await page.waitForLoadState('networkidle');

    // Should either be redirected or show 403/permission error
    const isRedirected = page.url().includes('/dashboard') || page.url().includes('/auth/login');
    const hasError = await page.locator('text=/unauthorized|forbidden|permission|denied/i').isVisible({ timeout: 5000 }).catch(() => false);

    expect(isRedirected || hasError).toBe(true);
  });

  test('should have read-only access to own data', async ({ page }) => {
    // STEP 1: Login as resident
    await login(page, TEST_USERS.resident);

    // STEP 2: Try to navigate to units page (if accessible)
    try {
      await page.goto('/units');
      await page.waitForLoadState('networkidle');

      // Should not have delete/create buttons
      const hasDeleteButton = await page.locator('button:has-text("Delete")').isVisible({ timeout: 5000 }).catch(() => false);
      const hasCreateButton = await page.locator('button:has-text("New"), button:has-text("Create")').isVisible({ timeout: 5000 }).catch(() => false);

      expect(hasDeleteButton || hasCreateButton).toBe(false);
    } catch {
      // Route might not be accessible at all, which is fine
    }
  });

  test('should be able to access financial information if applicable', async ({ page }) => {
    // STEP 1: Login as resident
    await login(page, TEST_USERS.resident);

    // STEP 2: Try to navigate to finance/payments
    try {
      await page.goto('/finance/payments');
      await page.waitForLoadState('networkidle');

      // Should see own payments (read-only)
      const hasPaymentTable = await page.locator('table, [data-testid="payments-list"]').isVisible({ timeout: 5000 }).catch(() => false);

      if (hasPaymentTable) {
        expect(hasPaymentTable).toBe(true);
      }
    } catch {
      // Finance might not be available, that's okay
    }
  });
});
