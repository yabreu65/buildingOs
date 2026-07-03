import { test, expect } from '@playwright/test';
import { login, logout, TEST_USERS } from '../helpers/auth';

test.describe('Tenant - Routing and Context', () => {
  test('should keep tenant admin on the matching tenant dashboard', async ({ page }) => {
    const tenantId = await login(page, TEST_USERS.tenantAdminA);

    await page.goto(`/${tenantId}/dashboard`);

    await expect(page).toHaveURL(new RegExp(`/${tenantId}/dashboard$`));
    await expect(page.getByRole('heading', { name: /panel de administración/i })).toBeVisible();
  });

  test('should deny access when an authenticated user enters another tenant context', async ({ page }) => {
    const tenantAId = await login(page, TEST_USERS.tenantAdminA);
    await logout(page);

    const tenantBId = await login(page, TEST_USERS.tenantAdminB);
    expect(tenantBId).not.toBe(tenantAId);

    await page.goto(`/${tenantAId}/dashboard`);

    await expect(page).toHaveURL(new RegExp(`/${tenantBId}/dashboard$`));
    await expect(page.getByRole('heading', { name: /panel de administración/i })).toBeVisible();
    await expect(page.getByText(/condominio: test tenant b/i)).toBeVisible();
  });
});
