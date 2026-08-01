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

    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    await expect(page.getByText(/inicia sesión con tu cuenta/i)).toBeVisible();
  });

  test('should keep /login public and redirect authenticated users away from it', async ({ page }) => {
    const tenantId = await login(page, TEST_USERS.tenantAdminA);

    await page.goto('/login');

    await expect(page).toHaveURL(new RegExp(`/${tenantId}/dashboard$`));
  });

  test('should clear revoked bootstrap state on /auth/me 401 and keep protected access revoked after reload, back, and forward', async ({
    page,
  }) => {
    const tenantId = await login(page, TEST_USERS.tenantAdminA);

    await page.goto(`/${tenantId}/dashboard`);

    await page.evaluate(() => {
      localStorage.setItem('bo_impersonation', JSON.stringify({ source: 'test' }));
      sessionStorage.setItem('bo_impersonation_token', 'impersonation-token');
      sessionStorage.setItem('bo_impersonation_token_backup', 'impersonation-backup');
      sessionStorage.setItem('bo_session_sa_backup', 'session-backup');
    });

    await page.route('**/auth/me', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Unauthorized' }),
      });
    });

    await page.reload();

    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    await expect(page.getByText(/inicia sesión con tu cuenta/i)).toBeVisible();

    const authStorage = await page.evaluate(() => ({
      session: localStorage.getItem('bo_session'),
      lastTenant: localStorage.getItem('bo_last_tenant'),
      lastPortal: localStorage.getItem('bo_last_portal'),
      impersonation: localStorage.getItem('bo_impersonation'),
      impersonationToken: sessionStorage.getItem('bo_impersonation_token'),
      impersonationTokenBackup: sessionStorage.getItem('bo_impersonation_token_backup'),
      sessionBackup: sessionStorage.getItem('bo_session_sa_backup'),
    }));

    expect(authStorage.session).toBeNull();
    expect(authStorage.impersonation).toBeNull();
    expect(authStorage.impersonationToken).toBeNull();
    expect(authStorage.impersonationTokenBackup).toBeNull();
    expect(authStorage.sessionBackup).toBeNull();
    expect(authStorage.lastTenant).toBe(tenantId);
    expect(authStorage.lastPortal).toBe('admin');

    await page.goBack();
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);

    await page.goForward();
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);

    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
  });
});
