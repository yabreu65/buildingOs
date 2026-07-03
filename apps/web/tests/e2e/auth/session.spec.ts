import { test, expect } from '@playwright/test';
import { login, logout, TEST_USERS } from '../helpers/auth';

test.describe('Auth - Session and Landing Flow', () => {
  test('should keep the public landing page accessible at root without redirecting to login', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: /administrá tu condominio/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /ingresar/i })).toBeVisible();
  });

  test('should login, refresh, and keep the session alive', async ({ page }) => {
    const tenantId = await login(page, TEST_USERS.tenantAdminA);

    await expect(page).toHaveURL(new RegExp(`/${tenantId}/dashboard$`));

    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(new RegExp(`/${tenantId}/dashboard$`));
    await expect(page.getByRole('heading', { name: /panel de administración/i })).toBeVisible();
  });

  test('should logout server-side and return to login', async ({ page }) => {
    await login(page, TEST_USERS.tenantAdminA);

    await logout(page);

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText(/inicia sesión con tu cuenta/i)).toBeVisible();
  });

  test('should keep /login public and redirect authenticated users away from it', async ({ page }) => {
    const tenantId = await login(page, TEST_USERS.tenantAdminA);

    await page.goto('/login');

    await expect(page).toHaveURL(new RegExp(`/${tenantId}/dashboard$`));
  });
});
