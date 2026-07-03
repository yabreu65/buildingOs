import { test, expect } from '@playwright/test';
import { login, TEST_USERS } from '../helpers/auth';

test.describe('Auth - Route Guards', () => {
  test('should redirect anonymous visitors from private tenant routes to login', async ({ page }) => {
    await page.goto('/test-tenant/dashboard');

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText(/inicia sesión con tu cuenta/i)).toBeVisible();
  });

  test('should keep public routes accessible even without session', async ({ page }) => {
    await page.goto('/signup');

    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByText(/creá una nueva cuenta/i)).toBeVisible();
  });

  test('should redirect authenticated users away from /login', async ({ page }) => {
    const tenantId = await login(page, TEST_USERS.tenantAdminA);

    await page.goto('/login');

    await expect(page).toHaveURL(new RegExp(`/${tenantId}/dashboard$`));
  });
});
