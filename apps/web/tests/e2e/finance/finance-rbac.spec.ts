import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  EXPECTED_FAILURE_STATUSES,
  attachBrowserObservability,
  expectHTTPFailure,
  expectHTTPSuccess,
  login,
  loginAsFinanceAdmin,
  resolveFinanceAdminContext,
  TEST_USERS,
} from '../helpers';

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL?.trim() || 'http://localhost:4000';
const LEGACY_AUTO_OFFSET_INCOME_ID = 'seed-legacy-backfill-auto-offset-2025-10';
const runFile = promisify(execFile);
const RUNNER = resolve(__dirname, '../../../../api/prisma/fin07d-e2e-reset.runner.ts');
const TS_NODE_REGISTER = resolve(__dirname, '../../../../api/node_modules/ts-node/register');
const RUNNER_CWD = resolve(__dirname, '../../../../api');

interface FinanceMutationTargets {
  readonly liquidationId: string;
  readonly incomeId: string;
  readonly incomeCategoryId: string;
  readonly fundId: string;
}

interface LegacyInspection {
  readonly applications: unknown[];
  readonly fundTransactions: unknown[];
}

function headers(tenantId: string): Record<string, string> {
  return { 'X-Tenant-Id': tenantId, 'x-portal-context': 'admin' };
}

function assertClean(observability: ReturnType<typeof attachBrowserObservability>): void {
  expect(observability.pageErrors).toHaveLength(0);
  expect(observability.consoleErrors).toHaveLength(0);
  expect(observability.http5xx).toHaveLength(0);
  expect(observability.http401).toHaveLength(0);
}

async function inspectLegacy(): Promise<LegacyInspection> {
  const { stdout } = await runFile(process.execPath, ['-r', TS_NODE_REGISTER, RUNNER, 'inspect-legacy', LEGACY_AUTO_OFFSET_INCOME_ID], {
    cwd: RUNNER_CWD,
    env: { ...process.env, FIN07D_E2E_RESET: '1', NODE_ENV: 'development' },
  });
  return JSON.parse(stdout) as LegacyInspection;
}

async function resolveMutationTargets(page: Parameters<typeof loginAsFinanceAdmin>[0], tenantId: string, buildingId: string): Promise<FinanceMutationTargets> {
  const [liquidationsResponse, incomesResponse, fundsResponse] = await Promise.all([
    expectHTTPSuccess(page.request, { method: 'GET', url: `${API_ORIGIN}/tenants/${tenantId}/finance/liquidations?buildingId=${buildingId}&period=2026-03`, headers: headers(tenantId) }),
    expectHTTPSuccess(page.request, { method: 'GET', url: `${API_ORIGIN}/tenants/${tenantId}/finance/incomes?buildingId=${buildingId}&period=2025-10`, headers: headers(tenantId) }),
    expectHTTPSuccess(page.request, { method: 'GET', url: `${API_ORIGIN}/tenants/${tenantId}/finance/funds`, headers: headers(tenantId) }),
  ]);
  const liquidations = await liquidationsResponse.json() as Array<{ id: string }>;
  const incomes = await incomesResponse.json() as Array<{ id: string; categoryId: string }>;
  const funds = await fundsResponse.json() as Array<{ id: string }>;
  expect(liquidations[0]).toBeTruthy();
  expect(incomes[0]).toBeTruthy();
  expect(funds[0]).toBeTruthy();
  return {
    liquidationId: liquidations[0]!.id,
    incomeId: incomes[0]!.id,
    incomeCategoryId: incomes[0]!.categoryId,
    fundId: funds[0]!.id,
  };
}

test.describe('FIN-07D finance RBAC and tenant isolation', () => {
  test('Admin A can use Tenant A finance and legacy backfill', async ({ page }) => {
    const tenantId = await loginAsFinanceAdmin(page);
    const context = await resolveFinanceAdminContext(page, tenantId);
    const observability = attachBrowserObservability(page);
    try {
      await page.goto(`/${tenantId}/finanzas?tab=incomes`);
      await expect(page.getByRole('heading', { name: 'Ingresos' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Migración histórica' })).toBeVisible();
      await page.goto(`/${tenantId}/buildings/${context.buildingId}/finance?period=2026-03`);
      await expect(page.getByRole('heading', { name: 'Finanzas del edificio' })).toBeVisible();
      for (const url of [
        `${API_ORIGIN}/tenants/${tenantId}/finance/liquidations?buildingId=${context.buildingId}&period=2026-03`,
        `${API_ORIGIN}/tenants/${tenantId}/finance/incomes?buildingId=${context.buildingId}&period=2026-06`,
        `${API_ORIGIN}/tenants/${tenantId}/finance/funds`,
        `${API_ORIGIN}/tenants/${tenantId}/finance/income-policies`,
        `${API_ORIGIN}/tenants/${tenantId}/finance/incomes/legacy-backfill/preview`,
      ]) {
        await expectHTTPSuccess(page.request, { method: 'GET', url, headers: headers(tenantId) });
      }
    } finally {
      observability.detach();
    }
    assertClean(observability);
  });

  test('Operator A retains allowed finance reads but cannot apply tenant-admin legacy backfill', async ({ page }) => {
    const tenantId = await login(page, TEST_USERS.operator);
    const context = await resolveFinanceAdminContext(page, tenantId);
    const observability = attachBrowserObservability(page);
    try {
      await page.goto(`/${tenantId}/finanzas?tab=incomes`);
      await expect(page.getByRole('heading', { name: 'Ingresos' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Migración histórica' })).toHaveCount(0);
      await expectHTTPSuccess(page.request, {
        method: 'GET',
        url: `${API_ORIGIN}/tenants/${tenantId}/finance/liquidations?buildingId=${context.buildingId}&period=2026-03`,
        headers: headers(tenantId),
      });
      await expectHTTPFailure(page.request, {
        method: 'GET',
        url: `${API_ORIGIN}/tenants/${tenantId}/finance/incomes/legacy-backfill/preview`,
        headers: headers(tenantId),
        expectedStatus: EXPECTED_FAILURE_STATUSES.FORBIDDEN,
      });
      await expectHTTPFailure(page.request, {
        method: 'POST',
        url: `${API_ORIGIN}/tenants/${tenantId}/finance/incomes/legacy-backfill/apply`,
        headers: headers(tenantId),
        data: { items: [{ incomeId: LEGACY_AUTO_OFFSET_INCOME_ID }] },
        expectedStatus: EXPECTED_FAILURE_STATUSES.FORBIDDEN,
      });
    } finally {
      observability.detach();
    }
    assertClean(observability);
  });

  test('Resident A cannot use Tenant A finance administration', async ({ page }) => {
    const tenantId = await login(page, TEST_USERS.resident);
    const adminBrowserContext = await page.context().browser()!.newContext();
    const adminPage = await adminBrowserContext.newPage();
    const adminTenantId = await loginAsFinanceAdmin(adminPage);
    const adminContext = await resolveFinanceAdminContext(adminPage, adminTenantId);
    const targets = await resolveMutationTargets(adminPage, adminTenantId, adminContext.buildingId);
    await adminBrowserContext.close();
    const observability = attachBrowserObservability(page);
    try {
      expect(tenantId).toBe(adminTenantId);
      await page.goto(`/${tenantId}/finanzas?tab=incomes`);
      await expect(page).toHaveURL(new RegExp(`/${tenantId}/resident/dashboard`));
      for (const request of [
        { name: 'liquidation create', method: 'POST' as const, url: `${API_ORIGIN}/tenants/${tenantId}/finance/liquidations/draft`, data: { buildingId: adminContext.buildingId, period: '2026-08', baseCurrency: 'ARS' } },
        { name: 'liquidation review', method: 'POST' as const, url: `${API_ORIGIN}/tenants/${tenantId}/finance/liquidations/${targets.liquidationId}/review` },
        { name: 'income create', method: 'POST' as const, url: `${API_ORIGIN}/tenants/${tenantId}/finance/incomes`, data: { buildingId: adminContext.buildingId, period: '2026-08', categoryId: targets.incomeCategoryId, amountMinor: 1, currencyCode: 'ARS', receivedDate: '2026-08-01' } },
        { name: 'application create', method: 'POST' as const, url: `${API_ORIGIN}/tenants/${tenantId}/finance/incomes/${LEGACY_AUTO_OFFSET_INCOME_ID}/applications`, data: { applications: [{ destinationType: 'OFFSET_EXPENSES', amountMinor: 1 }] } },
        { name: 'fund list', method: 'GET' as const, url: `${API_ORIGIN}/tenants/${tenantId}/finance/funds` },
        { name: 'fund update', method: 'PATCH' as const, url: `${API_ORIGIN}/tenants/${tenantId}/finance/funds/${targets.fundId}`, data: { name: 'Resident forbidden fund update' } },
        { name: 'policy list', method: 'GET' as const, url: `${API_ORIGIN}/tenants/${tenantId}/finance/income-policies` },
        { name: 'policy deactivate', method: 'POST' as const, url: `${API_ORIGIN}/tenants/${tenantId}/finance/income-policies/${targets.incomeCategoryId}/deactivate` },
        { name: 'legacy apply', method: 'POST' as const, url: `${API_ORIGIN}/tenants/${tenantId}/finance/incomes/legacy-backfill/apply`, data: { items: [{ incomeId: LEGACY_AUTO_OFFSET_INCOME_ID }] } },
      ]) {
        const response = await page.request.fetch(request.url, {
          method: request.method,
          data: request.data,
          headers: { Accept: 'application/json', ...headers(tenantId) },
        });
        expect(response.status(), request.name).toBe(EXPECTED_FAILURE_STATUSES.FORBIDDEN);
      }
    } finally {
      observability.detach();
    }
    assertClean(observability);
  });

  test('Admin B receives exact Tenant A 403 responses without data leakage', async ({ page }) => {
    const tenantBId = await login(page, TEST_USERS.tenantAdminB);
    const adminABrowserContext = await page.context().browser()!.newContext();
    const adminAPage = await adminABrowserContext.newPage();
    const tenantAId = await loginAsFinanceAdmin(adminAPage);
    const context = await resolveFinanceAdminContext(adminAPage, tenantAId);
    const before = await inspectLegacy();
    await adminABrowserContext.close();
    const observability = attachBrowserObservability(page);
    try {
      expect(tenantBId).not.toBe(tenantAId);
      for (const url of [
        `${API_ORIGIN}/tenants/${tenantAId}/buildings`,
        `${API_ORIGIN}/tenants/${tenantAId}/finance/liquidations?buildingId=${context.buildingId}&period=2026-03`,
        `${API_ORIGIN}/tenants/${tenantAId}/finance/incomes?buildingId=${context.buildingId}&period=2026-06`,
        `${API_ORIGIN}/tenants/${tenantAId}/finance/funds`,
        `${API_ORIGIN}/tenants/${tenantAId}/finance/income-policies`,
        `${API_ORIGIN}/tenants/${tenantAId}/finance/incomes/legacy-backfill/preview`,
      ]) {
        await expectHTTPFailure(page.request, {
          method: 'GET', url, headers: headers(tenantAId), expectedStatus: EXPECTED_FAILURE_STATUSES.FORBIDDEN,
        });
      }
      await expectHTTPFailure(page.request, {
        method: 'POST',
        url: `${API_ORIGIN}/tenants/${tenantAId}/finance/incomes/legacy-backfill/apply`,
        headers: headers(tenantAId),
        data: { items: [{ incomeId: LEGACY_AUTO_OFFSET_INCOME_ID }] },
        expectedStatus: EXPECTED_FAILURE_STATUSES.FORBIDDEN,
      });
      const after = await inspectLegacy();
      expect(after.applications).toEqual(before.applications);
      expect(after.fundTransactions).toEqual(before.fundTransactions);
    } finally {
      observability.detach();
    }
    assertClean(observability);
  });
});
