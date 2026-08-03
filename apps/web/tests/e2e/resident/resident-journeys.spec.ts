import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

function residentDocumentsPath(tenantId: string): string {
  return `/${tenantId}/resident/documents`;
}

interface ResidentContextResponse {
  activeBuildingId: string | null;
  activeUnitId: string | null;
}

interface DocumentListItem {
  id: string;
  title: string;
  file: {
    id: string;
    bucket: string;
    objectKey: string;
    originalName: string;
    mimeType: string;
    size: number;
  };
}

interface PresignUploadResponse {
  url: string;
  bucket: string;
  objectKey: string;
}

const DOCUMENT_FIXTURE_PATH = resolve(
  process.cwd(),
  '../../docs/BUILDINGOS_VALOR_DIRECTIVA_CONDOMINIOS.pdf',
);

async function getResidentContext(page: Page, tenantId: string): Promise<ResidentContextResponse> {
  const response = await page.request.get(`${API_ORIGIN}/me/context`, {
    headers: {
      'X-Tenant-Id': tenantId,
      Accept: 'application/json',
    },
  });

  expect(response.ok()).toBe(true);
  return (await response.json()) as ResidentContextResponse;
}

async function ensureResidentDocumentFixture(
  page: Page,
  tenantId: string,
  buildingId: string,
  unitId: string,
  projectName: string,
): Promise<DocumentListItem> {
  const documentTitle = `Directiva de la unidad A1-102 - ${projectName}`;
  const fixtureName = 'buildingos-directiva-condominios.pdf';
  const fixtureMimeType = 'application/pdf';
  const fixtureBytes = readFileSync(DOCUMENT_FIXTURE_PATH);

  const listResponse = await page.request.get(
    `${API_ORIGIN}/tenants/${tenantId}/documents?buildingId=${buildingId}&unitId=${unitId}&visibility=RESIDENTS`,
    {
      headers: {
        'X-Tenant-Id': tenantId,
        Accept: 'application/json',
      },
    },
  );

  expect(listResponse.ok()).toBe(true);
  const existingDocuments = (await listResponse.json()) as DocumentListItem[];
  const existingDocument = existingDocuments.find((document) => document.title === documentTitle);
  if (existingDocument) {
    return existingDocument;
  }

  const presignResponse = await page.request.post(`${API_ORIGIN}/tenants/${tenantId}/documents/presign`, {
    headers: {
      'X-Tenant-Id': tenantId,
      Accept: 'application/json',
    },
    data: {
      originalName: fixtureName,
      mimeType: fixtureMimeType,
      size: fixtureBytes.length,
      purpose: 'GENERAL_DOCUMENT',
    },
  });

  expect(presignResponse.ok()).toBe(true);
  const presign = (await presignResponse.json()) as PresignUploadResponse;

  const uploadResponse = await page.request.put(presign.url, {
    data: fixtureBytes,
    headers: {
      'Content-Type': fixtureMimeType,
    },
  });

  expect(uploadResponse.ok()).toBe(true);

  const createResponse = await page.request.post(`${API_ORIGIN}/tenants/${tenantId}/documents`, {
    headers: {
      'X-Tenant-Id': tenantId,
      Accept: 'application/json',
    },
    data: {
      title: documentTitle,
      category: 'RULES',
      visibility: 'RESIDENTS',
      file: {
        bucket: presign.bucket,
        objectKey: presign.objectKey,
        originalName: fixtureName,
        mimeType: fixtureMimeType,
        size: fixtureBytes.length,
      },
      buildingId,
      unitId,
    },
  });

  expect(createResponse.ok()).toBe(true);
  return (await createResponse.json()) as DocumentListItem;
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
    await expect(page.getByRole('heading', { name: /mis reclamos/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /ver comunicados/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /crear reclamo/i })).toBeVisible();

    await page.goto(residentUnitPath(tenantId));
    await expect(page.getByRole('heading', { name: /mi unidad/i })).toBeVisible();
    await expect(
      page.getByText('Código', { exact: true }).locator('..').getByText('A1-102', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Test Resident', { exact: true }).first()).toBeVisible();
  });

  test('shows the resident unit details for the route tenant without a false empty state', async ({ page }) => {
    const tenantId = await login(page, TEST_USERS.resident);

    await page.goto(residentUnitPath(tenantId));

    await expect(page).toHaveURL(new RegExp(`/${tenantId}/resident/unit$`));
    await expect(page.getByRole('heading', { name: /mi unidad/i })).toBeVisible();
    await expect(page.getByText('Torre A Test', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Unidad A1-102', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('A1-102', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Ocupada')).toBeVisible();
    await expect(page.getByText('Residente', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('No hay ocupantes registrados')).toHaveCount(0);
    await expect(page.getByText('Sin unidad asignada')).toHaveCount(0);
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

  test('shows the resident profile for the route tenant with a readonly access email', async ({ page }) => {
    const tenantId = await login(page, TEST_USERS.resident);

    await page.goto(`/${tenantId}/resident/profile`);

    await expect(page).toHaveURL(new RegExp(`/${tenantId}/resident/profile$`));
    await expect(page.getByRole('heading', { name: /mi perfil/i })).toBeVisible();
    await expect(page.getByLabel('Nombre')).toHaveValue('Test Resident');
    const emailField = page.getByLabel('Correo de acceso');
    await expect(emailField).toHaveValue('test-resident@buildingos.local');
    await expect(emailField).toHaveAttribute('readonly', '');
    await expect(page.getByText('user-1')).toHaveCount(0);
    await expect(page.getByText(tenantId)).toHaveCount(0);
  });

  test('shows the resident documents preview for the route tenant', async ({ page }, testInfo) => {
    const residentTenantId = await login(page, TEST_USERS.resident);
    const residentContext = await getResidentContext(page, residentTenantId);

    expect(residentContext.activeBuildingId).toBeTruthy();
    expect(residentContext.activeUnitId).toBeTruthy();

    await logout(page);

    const tenantId = await login(page, TEST_USERS.tenantAdminA);
    expect(tenantId).toBe(residentTenantId);

    const seededDocument = await ensureResidentDocumentFixture(
      page,
      tenantId,
      residentContext.activeBuildingId!,
      residentContext.activeUnitId!,
      testInfo.project.name,
    );

    await logout(page);

    const residentTenantIdAgain = await login(page, TEST_USERS.resident);
    expect(residentTenantIdAgain).toBe(tenantId);

    await page.goto(residentDocumentsPath(tenantId));

    await expect(page).toHaveURL(new RegExp(`/${tenantId}/resident/documents$`));
    await expect(page.getByRole('heading', { name: /documentos/i })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`ver documento ${seededDocument.title}`, 'i') })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(`ver documento ${seededDocument.title}`, 'i') }).click();

    await expect(page.getByRole('dialog', { name: new RegExp(`vista de ${seededDocument.title}`, 'i') })).toBeVisible();
    const iframe = page.locator('iframe');
    await expect(iframe).toHaveCount(1);
    await expect(iframe).toHaveAttribute('src', /blob:/);
    await expect(page.getByRole('button', { name: /descargar/i })).toBeVisible();
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

    await expect(page).toHaveURL(
      new RegExp(`/${tenantAId}/resident/dashboard$`),
      { timeout: 15000 },
    );
    await expect(page).not.toHaveURL(new RegExp(`/${tenantBId}/resident/`));
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
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
      await page.goto(`/${tenantId}/${route}`);
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
    await expect(page.getByText('Comunicado Unidad 102')).toBeVisible();
    await expect(page.getByText('Comunicado Unidad 103')).toHaveCount(0);

    await setResidentUnit(unit103Id);
    await expect(page.getByText(/contexto actual:.*unidad a1-103/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Comunicado Unidad 103')).toBeVisible();
    await expect(page.getByText('Comunicado Unidad 102')).toHaveCount(0);
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
