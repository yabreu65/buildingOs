import { expect, test } from '@playwright/test';
import { residentTicketDetailPath } from '../../../shared/lib/routes';
import { login, logout, TEST_USERS } from '../helpers/auth';

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL?.trim() || 'http://localhost:4000';

function residentDashboardPath(tenantId: string): string {
  return `/${tenantId}/resident/dashboard`;
}

function residentUnitPath(tenantId: string): string {
  return `/${tenantId}/resident/unit`;
}

function residentPaymentsPath(tenantId: string): string {
  return `/${tenantId}/resident/payments`;
}

function residentAnnouncementsPath(tenantId: string): string {
  return `/${tenantId}/resident/announcements`;
}

function residentTicketsPath(tenantId: string): string {
  return `/${tenantId}/resident/tickets`;
}

test.describe('Resident critical journeys', () => {
  test('rejects invalid credentials without leaving auth cookies behind', async ({ page }) => {
    await page.goto('/login');

    await page.getByTestId('login-email').fill(TEST_USERS.resident.email);
    await page.getByTestId('login-password').fill('WrongPass123!');
    await page.getByTestId('login-submit').click();

    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    await expect(page.getByText(/credenciales inválidas/i)).toBeVisible();

    const cookies = await page.context().cookies([API_ORIGIN]);
    const cookieNames = cookies.map((cookie) => cookie.name);

    expect(cookieNames).not.toContain('bo_access_token');
    expect(cookieNames).not.toContain('bo_refresh_token');
  });

  test('logs in a resident and shows the authorized dashboard context', async ({ page }) => {
    const tenantId = await login(page, TEST_USERS.resident);

    await expect(page).toHaveURL(new RegExp(`/${tenantId}/resident/dashboard$`));
    await expect(page.getByRole('heading', { name: /hola, test resident/i })).toBeVisible();
    await expect(page.getByText('Test Tenant A', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Torre A Test', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Unidad A1-102', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Saldo pendiente')).toBeVisible();
    await expect(page.getByText('Comunicado Unidad 102')).toBeVisible();
    await expect(page.getByText('Fuga en lavadero')).toBeVisible();
    await expect(page.getByRole('link', { name: /ver comunicados/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /crear reclamo/i })).toBeVisible();

    await page.goto(residentUnitPath(tenantId));
    await expect(page.getByRole('heading', { name: /mi unidad/i })).toBeVisible();
    await expect(
      page.getByText('Código', { exact: true }).locator('..').getByText('A1-102', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Test Resident', { exact: true }).first()).toBeVisible();
  });

  test('shows the resident finance snapshot and seeded payment history', async ({ page }) => {
    const tenantId = await login(page, TEST_USERS.resident);

    await page.goto(residentPaymentsPath(tenantId));

    await expect(page).toHaveURL(new RegExp(`/${tenantId}/resident/payments$`));
    await expect(page.getByRole('heading', { name: /^pagos$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /reportar pago/i })).toBeVisible();
    await expect(page.getByText('Saldo pendiente')).toBeVisible();
    await expect(page.getByText('Próximo vencimiento')).toBeVisible();
    await expect(page.getByText('TEST-REF-001')).toBeVisible();
  });

  test('shows the resident communications inbox for the authorized unit', async ({ page }) => {
    const tenantId = await login(page, TEST_USERS.resident);

    await page.goto(residentAnnouncementsPath(tenantId));

    await expect(page).toHaveURL(new RegExp(`/${tenantId}/resident/announcements$`));
    await expect(page.getByRole('heading', { name: /comunicados/i })).toBeVisible();
    await expect(page.getByText('Comunicado Unidad 102')).toBeVisible();
  });

  test('opens a resident ticket detail from the resident list', async ({ page }) => {
    const tenantId = await login(page, TEST_USERS.resident);

    await page.goto(residentTicketsPath(tenantId));

    await expect(page).toHaveURL(new RegExp(`/${tenantId}/resident/tickets$`));
    await expect(page.getByRole('heading', { name: /mis reclamos/i })).toBeVisible();
    await expect(page.getByText('Fuga en lavadero')).toBeVisible();

    await page.getByRole('link', { name: /ver reclamo fuga en lavadero/i }).click();

    await expect(page).toHaveURL(residentTicketDetailPath(tenantId, 'seed-ticket-unit-102'));
    await expect(page.getByRole('heading', { name: /detalle del ticket/i })).toBeVisible();
    await expect(page.getByText('Fuga en lavadero')).toBeVisible();
    await expect(page.getByText('Torre A Test', { exact: true })).toBeVisible();
    await expect(page.getByText('Unidad A1-102 (A1-102)', { exact: true })).toBeVisible();
  });

  test('blocks cross-tenant resident URL tampering', async ({ page }) => {
    const tenantBId = await login(page, TEST_USERS.tenantAdminB);
    await logout(page);

    const tenantAId = await login(page, TEST_USERS.resident);
    expect(tenantAId).not.toBe(tenantBId);

    await page.goto(residentDashboardPath(tenantBId));

    await expect(page).toHaveURL(new RegExp(`/${tenantAId}/resident/dashboard$`));
    await expect(page.getByRole('heading', { name: /hola, test resident/i })).toBeVisible();
  });

  test('keeps the resident route tenant when activeTenantId points to a different admin tenant', async ({ page }) => {
    const tenantBId = await login(page, TEST_USERS.tenantAdminB);
    await logout(page);

    const tenantAId = await login(page, TEST_USERS.residentMixed);

    await page.route('**/auth/me', async (route) => {
      const upstreamResponse = await route.fetch();
      const body = (await upstreamResponse.json()) as {
        user: { id: string; email: string; name: string };
        memberships: Array<{ tenantId: string; roles: string[]; scopedRoles?: unknown }>;
      };

      const memberships = body.memberships.some((membership) => membership.tenantId === tenantBId)
        ? body.memberships
        : [...body.memberships, { tenantId: tenantBId, roles: ['TENANT_ADMIN'] }];

      await route.fulfill({
        response: upstreamResponse,
        json: {
          ...body,
          memberships,
        },
      });
    });

    await page.evaluate((tenantId) => {
      localStorage.setItem('bo_last_tenant', tenantId);
      localStorage.removeItem('bo_session');
    }, tenantBId);

    await page.goto(residentDashboardPath(tenantAId), { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(new RegExp(`/${tenantAId}/resident/dashboard$`));
    await expect(page).not.toHaveURL(new RegExp(`/${tenantAId}/dashboard$`));
    await expect(page.getByRole('heading', { name: /hola, test resident admin/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /panel/i })).toHaveAttribute(
      'href',
      `/${tenantAId}/resident/dashboard`,
    );
    await expect(page.getByRole('link', { name: /mi perfil/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /pagos/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /comunicados/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /solicitudes/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /mi unidad/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /documentos/i })).toBeVisible();
    await expect(page.locator(`aside nav a[href="/${tenantAId}/buildings"]`)).toHaveCount(0);
    await expect(page.locator(`aside nav a[href="/${tenantAId}/units"]`)).toHaveCount(0);
    await expect(page.locator(`aside nav a[href="/${tenantAId}/finanzas"]`)).toHaveCount(0);

    const authSession = await page.evaluate(() => {
      const raw = localStorage.getItem('bo_session');
      return raw ? JSON.parse(raw) : null;
    });

    expect(authSession?.activeTenantId).toBe(tenantBId);
    expect(authSession?.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tenantId: tenantAId }),
        expect.objectContaining({ tenantId: tenantBId }),
      ]),
    );
  });

  test('keeps the mixed portal sidebar aligned with the active context', async ({ page }) => {
    const tenantId = await login(page, TEST_USERS.residentMixed);

    await page.goto(`/${tenantId}/dashboard`);
    await expect(page).toHaveURL(new RegExp(`/${tenantId}/dashboard$`));
    await expect(page.getByRole('heading', { name: /panel de administración/i })).toBeVisible();
    await expect(page.locator(`aside nav a[href="/${tenantId}/buildings"]`)).toBeVisible();
    await expect(page.locator(`aside nav a[href="/${tenantId}/units"]`)).toBeVisible();
    await expect(page.locator(`aside nav a[href="/${tenantId}/finanzas"]`)).toBeVisible();
    await expect(page.locator(`aside nav a[href="/${tenantId}/resident/profile"]`)).toHaveCount(0);
    await expect(page.locator(`aside nav a[href="/${tenantId}/resident/payments"]`)).toHaveCount(0);
    await expect(page.locator(`aside nav a[href="/${tenantId}/resident/unit"]`)).toHaveCount(0);

    await page.goto(`/${tenantId}/resident/dashboard`);
    await expect(page).toHaveURL(new RegExp(`/${tenantId}/resident/dashboard$`));
    await expect(page.getByRole('heading', { name: /hola, test resident admin/i })).toBeVisible();
    await expect(page.locator(`aside nav a[href="/${tenantId}/resident/profile"]`)).toBeVisible();
    await expect(page.locator(`aside nav a[href="/${tenantId}/resident/payments"]`)).toBeVisible();
    await expect(page.locator(`aside nav a[href="/${tenantId}/resident/unit"]`)).toBeVisible();
    await expect(page.locator(`aside nav a[href="/${tenantId}/buildings"]`)).toHaveCount(0);
    await expect(page.locator(`aside nav a[href="/${tenantId}/units"]`)).toHaveCount(0);
    await expect(page.locator(`aside nav a[href="/${tenantId}/finanzas"]`)).toHaveCount(0);

    await page.goto(`/${tenantId}/dashboard`);
    await expect(page).toHaveURL(new RegExp(`/${tenantId}/dashboard$`));
    await expect(page.getByRole('heading', { name: /panel de administración/i })).toBeVisible();
    await expect(page.locator(`aside nav a[href="/${tenantId}/buildings"]`)).toBeVisible();
    await expect(page.locator(`aside nav a[href="/${tenantId}/resident/profile"]`)).toHaveCount(0);
  });

  test('allows mixed-role users to stay on admin routes and keeps resident-only users out', async ({ page }) => {
    const tenantId = await login(page, TEST_USERS.residentMixed);

    await page.goto(`/${tenantId}/dashboard`);
    await expect(page).toHaveURL(new RegExp(`/${tenantId}/dashboard$`));

    for (const route of ['buildings', 'units', 'finanzas'] as const) {
      await page.locator(`aside nav a[href="/${tenantId}/${route}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/${tenantId}/${route}$`));
      await expect(page.locator(`aside nav a[href="/${tenantId}/buildings"]`)).toBeVisible();
      await expect(page.locator(`aside nav a[href="/${tenantId}/resident/profile"]`)).toHaveCount(0);
    }

    await logout(page);

    const residentTenantId = await login(page, TEST_USERS.resident);
    await page.goto(`/${residentTenantId}/buildings`);

    await expect(page).toHaveURL(new RegExp(`/${residentTenantId}/resident/dashboard$`));
    await expect(page.getByRole('heading', { name: /hola, test resident/i })).toBeVisible();
    await expect(page.locator(`aside nav a[href="/${residentTenantId}/buildings"]`)).toHaveCount(0);
  });

  test('switches the active resident unit and refreshes scoped content', async ({ page }) => {
    const tenantId = await login(page, TEST_USERS.residentMulti);

    await page.goto(residentAnnouncementsPath(tenantId));

    const unitSelectId = `#context-unit-select-${tenantId}`;
    const [unit102Id, unit103Id] = await page.locator(unitSelectId).evaluate((element) => {
      const select = element as HTMLSelectElement;
      const options = Array.from(select.options).map((option) => option.value);
      return [options[0] ?? '', options[1] ?? ''] as const;
    });

    expect(unit102Id).toBeTruthy();
    expect(unit103Id).toBeTruthy();

    const setResidentUnit = async (unitId: string): Promise<void> => {
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            response.url().includes('/me/context'),
        ),
        page.evaluate(
          ({ selectId, value }) => {
            const select = document.querySelector<HTMLSelectElement>(selectId);
            if (!select) {
              throw new Error(`Missing select ${selectId}`);
            }

            select.value = value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          },
          { selectId: unitSelectId, value: unitId },
        ),
      ]);
    };

    await setResidentUnit(unit102Id);
    await expect(page.getByText(/contexto actual:.*unidad a1-102/i)).toBeVisible({ timeout: 15000 });

    await setResidentUnit(unit103Id);
    await expect(page.getByText(/contexto actual:.*unidad a1-103/i)).toBeVisible({ timeout: 15000 });
  });

  test('logs out and keeps protected resident routes inaccessible', async ({ page }) => {
    const tenantId = await login(page, TEST_USERS.resident);

    await logout(page);
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);

    await page.goto(residentDashboardPath(tenantId));
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    await expect(page.getByText(/inicia sesión con tu cuenta/i)).toBeVisible();

    const cookies = await page.context().cookies([API_ORIGIN]);
    const cookieNames = cookies.map((cookie) => cookie.name);

    expect(cookieNames).not.toContain('bo_access_token');
    expect(cookieNames).not.toContain('bo_refresh_token');
  });
});
