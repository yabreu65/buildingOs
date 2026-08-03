import { expect, test, type Browser, type Page } from '@playwright/test';
import { login, logout, TEST_USERS } from '../helpers/auth';

const POLL_TIMEOUT_MS = 45_000;

test.describe.configure({ timeout: 45_000 });

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function createResidentTicket(page: Page, tenantId: string, title: string, description: string): Promise<void> {
  await page.goto(`/${tenantId}/resident/tickets`);
  await page.getByRole('button', { name: /crear reclamo/i }).first().click();
  await expect(page.locator('#resident-ticket-title')).toBeVisible();
  await page.locator('#resident-ticket-title').fill(title);
  await page.locator('#resident-ticket-description').fill(description);
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByText(title, { exact: false })).toBeVisible({ timeout: POLL_TIMEOUT_MS });
}

async function waitForNotificationTitle(page: Page, title: string): Promise<void> {
  const menuItem = page.getByRole('menuitem', { name: new RegExp(escapeRegExp(title), 'i') });

  await expect.poll(
    async () => menuItem.count(),
    { timeout: POLL_TIMEOUT_MS },
  ).toBeGreaterThan(0);

  await expect(menuItem.first()).toBeVisible();
}

async function openNotificationCenter(page: Page, notificationTitle: string): Promise<void> {
  await page.getByRole('button', { name: /notificaciones/i }).click();
  await waitForNotificationTitle(page, notificationTitle);
}

async function createContexts(browser: Browser) {
  const residentContext = await browser.newContext();
  const adminContext = await browser.newContext();

  return {
    residentContext,
    adminContext,
    residentPage: await residentContext.newPage(),
    adminPage: await adminContext.newPage(),
  };
}

test.describe.serial('Administration global notification alerts', () => {
  test('resident tickets notify administration and open the canonical admin detail', async ({ browser }) => {
    const { residentContext, adminContext, residentPage, adminPage } = await createContexts(browser);

    try {
      const residentTenantId = await login(residentPage, TEST_USERS.resident);
      const adminTenantId = await login(adminPage, TEST_USERS.tenantAdminA);

      expect(adminTenantId).toBe(residentTenantId);

      const ticketTitle = `Leak detected ${Date.now().toString(36)}`;
      const ticketDescription = `Water leak reported at ${Date.now().toString(36)}`;
      const adminNotificationTitle = `Nuevo reclamo: ${ticketTitle}`;

      await createResidentTicket(residentPage, residentTenantId, ticketTitle, ticketDescription);

      await adminPage.goto(`/${adminTenantId}/dashboard`);
      await openNotificationCenter(adminPage, adminNotificationTitle);
      await adminPage.getByRole('menuitem', { name: new RegExp(escapeRegExp(adminNotificationTitle), 'i') }).click();

      await expect(adminPage).toHaveURL(new RegExp(`/${adminTenantId}/tickets/[^?]+(?:\\?.*)?$`));
      await expect(adminPage.getByRole('heading', { name: ticketTitle, exact: false })).toBeVisible();
    } finally {
      await Promise.all([residentContext.close(), adminContext.close()]);
    }
  });

  test('administration replies reach the resident feed without manual refresh', async ({ browser }) => {
    const { residentContext, adminContext, residentPage, adminPage } = await createContexts(browser);

    try {
      const residentTenantId = await login(residentPage, TEST_USERS.resident);
      const adminTenantId = await login(adminPage, TEST_USERS.tenantAdminA);

      expect(adminTenantId).toBe(residentTenantId);

      const ticketTitle = `Drain issue ${Date.now().toString(36)}`;
      const ticketDescription = `Drain issue description ${Date.now().toString(36)}`;
      const residentNotificationTitle = `La administración respondió: ${ticketTitle}`;

      await createResidentTicket(residentPage, residentTenantId, ticketTitle, ticketDescription);
      await openNotificationCenter(adminPage, `Nuevo reclamo: ${ticketTitle}`);
      await adminPage.getByRole('menuitem', {
        name: new RegExp(escapeRegExp(`Nuevo reclamo: ${ticketTitle}`), 'i'),
      }).click();
      await expect(adminPage.getByRole('heading', { name: ticketTitle, exact: false })).toBeVisible();

      await adminPage.locator('#ticket-comment').fill(`Respuesta administrativa ${Date.now().toString(36)}`);
      await adminPage.getByRole('button', { name: /enviar respuesta/i }).click();
      await expect(adminPage.getByText(/respuesta administrativa/i)).toBeVisible({ timeout: POLL_TIMEOUT_MS });

      await residentPage.goto(`/${residentTenantId}/resident/tickets`);
      await openNotificationCenter(residentPage, residentNotificationTitle);
      await residentPage.getByRole('menuitem', {
        name: new RegExp(escapeRegExp(residentNotificationTitle), 'i'),
      }).click();

      await expect(residentPage).toHaveURL(
        new RegExp(`/${residentTenantId}/tickets/[^?]+\\?portal=resident$`),
      );
      await expect(residentPage.getByRole('heading', { name: ticketTitle, exact: false })).toBeVisible();
    } finally {
      await Promise.all([residentContext.close(), adminContext.close()]);
    }
  });

  test('mixed-role residents keep resident routing in the notification center', async ({ browser }) => {
    const residentCreatorContext = await browser.newContext();
    const residentMixedContext = await browser.newContext();
    const adminContext = await browser.newContext();
    const residentCreatorPage = await residentCreatorContext.newPage();
    const residentMixedPage = await residentMixedContext.newPage();
    const adminPage = await adminContext.newPage();

    try {
      const residentCreatorTenantId = await login(residentCreatorPage, TEST_USERS.residentMulti);
      const residentTenantId = await login(residentMixedPage, TEST_USERS.residentMixed);
      const adminTenantId = await login(adminPage, TEST_USERS.tenantAdminA);

      expect(adminTenantId).toBe(residentCreatorTenantId);
      expect(residentTenantId).toBe(residentCreatorTenantId);

      const ticketTitle = `Resident portal ${Date.now().toString(36)}`;
      const ticketDescription = `Resident portal description ${Date.now().toString(36)}`;
      await createResidentTicket(residentCreatorPage, residentCreatorTenantId, ticketTitle, ticketDescription);
      await openNotificationCenter(adminPage, `Nuevo reclamo: ${ticketTitle}`);
      await adminPage.getByRole('menuitem', {
        name: new RegExp(escapeRegExp(`Nuevo reclamo: ${ticketTitle}`), 'i'),
      }).click();
      await adminPage.locator('#ticket-comment').fill(`Respuesta para residente ${Date.now().toString(36)}`);
      await adminPage.getByRole('button', { name: /enviar respuesta/i }).click();

      await residentMixedPage.goto(`/${residentTenantId}/notifications?portal=resident`);
      await expect(residentMixedPage).toHaveURL(
        new RegExp(`/${residentTenantId}/notifications\\?portal=resident$`),
      );
      await expect(residentMixedPage.getByRole('heading', { name: /notificaciones/i })).toBeVisible();
    } finally {
      await Promise.all([
        residentCreatorContext.close(),
        residentMixedContext.close(),
        adminContext.close(),
      ]);
    }
  });

  test('tenant changes do not leak the previous principal notification cache', async ({ browser }) => {
    const { residentContext, adminContext, residentPage, adminPage } = await createContexts(browser);

    try {
      const tenantAId = await login(adminPage, TEST_USERS.tenantAdminA);
      const residentTenantId = await login(residentPage, TEST_USERS.resident);
      expect(tenantAId).toBe(residentTenantId);

      const ticketTitle = `Isolation ${Date.now().toString(36)}`;
      const ticketDescription = `Isolation description ${Date.now().toString(36)}`;

      await createResidentTicket(residentPage, residentTenantId, ticketTitle, ticketDescription);

      await adminPage.goto(`/${tenantAId}/dashboard`);
      await openNotificationCenter(adminPage, `Nuevo reclamo: ${ticketTitle}`);
      await adminPage.getByRole('menuitem', {
        name: new RegExp(escapeRegExp(`Nuevo reclamo: ${ticketTitle}`), 'i'),
      }).click();
      await expect(adminPage.getByRole('heading', { name: ticketTitle, exact: false })).toBeVisible();

      await logout(adminPage);
      const tenantBAfterRelogin = await login(adminPage, TEST_USERS.tenantAdminB);
      expect(tenantBAfterRelogin).not.toBe(tenantAId);

      await adminPage.goto(`/${tenantBAfterRelogin}/dashboard`);
      await pageAssertNotificationAbsent(adminPage, ticketTitle);
    } finally {
      await Promise.all([residentContext.close(), adminContext.close()]);
    }
  });
});

async function pageAssertNotificationAbsent(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: /notificaciones/i }).click();
  await expect.poll(
    async () => page.getByRole('menuitem', { name: new RegExp(escapeRegExp(title), 'i') }).count(),
    { timeout: 15_000 },
  ).toBe(0);
}
