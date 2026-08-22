import { expect, test, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  EXPECTED_FAILURE_STATUSES,
  attachBrowserObservability,
  acquireFin07dMutationLock,
  expectHTTPFailure,
  expectHTTPSuccess,
  loginAsFinanceAdmin,
  resolveFinanceAdminContext,
} from '../helpers';

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL?.trim() || 'http://localhost:4000';
const BASE_CURRENCY = 'ARS';
const NORMAL_V3_PERIOD = '2026-06';
const ZERO_NET_PERIOD = '2026-07';
const NORMAL_V3_EXPENSE_DESCRIPTION = '[FIN07D:NORMAL_V3] Expense A1 6000';
const ZERO_NET_EXPENSE_DESCRIPTION = '[FIN07D:ZERO_NET] Expense A1 5000';
const runFile = promisify(execFile);
const FIN07D_RUNNER = resolve(__dirname, '../../../../api/prisma/fin07d-e2e-reset.runner.ts');
const TS_NODE_REGISTER = resolve(__dirname, '../../../../api/node_modules/ts-node/register');
const RUNNER_CWD = resolve(__dirname, '../../../../api');

interface Fin07dFixtureContext {
  readonly tenantAId: string;
  readonly buildingA1Id: string;
  readonly normalV3ExpenseId: string;
  readonly normalV3BuildingApplicationId: string;
  readonly normalV3SharedApplicationId: string;
  readonly zeroNetExpenseId: string;
  readonly zeroNetApplicationId: string;
}

interface LiquidationOffsetSnapshot {
  readonly incomeApplicationId: string;
  readonly scopeType: 'BUILDING' | 'TENANT_SHARED' | 'UNIT_GROUP';
  readonly currencyCode: string;
  readonly applicationAmountMinor: number;
  readonly buildingAmountMinor: number;
  readonly valuedAmountMinor: number;
  readonly functionalCurrencyCode: string | null;
  readonly exchangeRateId: string | null;
  readonly exchangeRateValue: string | null;
  readonly exchangeRateDirection: string | null;
  readonly exchangeRateEffectiveAt: string | null;
  readonly conversionDate: string | null;
}

interface LiquidationDetailResponse {
  readonly id: string;
  readonly status: 'DRAFT' | 'REVIEWED' | 'PUBLISHED' | 'CANCELED';
  readonly valuationMode: 'FUNCTIONAL' | 'LEGACY_NOMINAL' | null;
  readonly baseCurrency: string;
  readonly totalAmountMinor: number;
  readonly grossExpenseAmountMinor: number | null;
  readonly adjustmentAmountMinor: number | null;
  readonly preIncomeAmountMinor: number | null;
  readonly incomeOffsetAmountMinor: number | null;
  readonly netDistributableAmountMinor: number | null;
  readonly incomeOffsetsByCurrency: Record<string, number> | null;
  readonly incomeOffsetSnapshot: LiquidationOffsetSnapshot[] | null;
  readonly chargesPreview: Array<{
    readonly unitId: string;
    readonly amountMinor: number;
  }>;
}

interface ExpenseResponse {
  readonly id: string;
  readonly description: string | null;
}

let fixture: Fin07dFixtureContext;
let releaseMutationLock: (() => Promise<void>) | undefined;

interface PersistedLiquidationProof {
  readonly offsets: Array<{
    readonly incomeApplicationId: string;
    readonly buildingId: string;
    readonly originalAmountMinor: number;
    readonly valuedAmountMinor: number;
    readonly currencyCode: string;
    readonly baseCurrency: string;
  }>;
  readonly chargeCount: number;
}

async function runFin07dReset(): Promise<Fin07dFixtureContext> {
  const { stdout } = await runFile(
    process.execPath,
    ['-r', TS_NODE_REGISTER, FIN07D_RUNNER, 'reset'],
    {
      cwd: RUNNER_CWD,
      env: {
        ...process.env,
        FIN07D_E2E_RESET: '1',
        NODE_ENV: 'development',
      },
    },
  );
  return JSON.parse(stdout) as Fin07dFixtureContext;
}

async function registerMutableLiquidation(liquidationId: string): Promise<void> {
  await runFile(
    process.execPath,
    ['-r', TS_NODE_REGISTER, FIN07D_RUNNER, 'register', liquidationId],
    {
      cwd: RUNNER_CWD,
      env: {
        ...process.env,
        FIN07D_E2E_RESET: '1',
        NODE_ENV: 'development',
      },
    },
  );
}

async function readPersistedLiquidationProof(
  liquidationId: string,
): Promise<PersistedLiquidationProof> {
  const { stdout } = await runFile(
    process.execPath,
    ['-r', TS_NODE_REGISTER, FIN07D_RUNNER, 'inspect', liquidationId],
    {
      cwd: RUNNER_CWD,
      env: {
        ...process.env,
        FIN07D_E2E_RESET: '1',
        NODE_ENV: 'development',
      },
    },
  );
  return JSON.parse(stdout) as PersistedLiquidationProof;
}

function liquidationUrl(tenantId: string, liquidationId: string): string {
  return `${API_ORIGIN}/tenants/${tenantId}/finance/liquidations/${liquidationId}`;
}

function financeHeaders(tenantId: string): Record<string, string> {
  return {
    'X-Tenant-Id': tenantId,
    'x-portal-context': 'admin',
  };
}

function moneyPattern(amountMinor: number): RegExp {
  return new RegExp(`(?:^|\\D)${amountMinor / 100}[,.]00(?:\\D|$)`);
}

function liquidationCard(page: Page, period: string) {
  return page
    .locator('div.rounded-lg.border.bg-background.shadow-sm')
    .filter({ hasText: `Período ${period}` });
}

async function createDraftThroughUi(
  page: Page,
  tenantId: string,
  period: string,
): Promise<LiquidationDetailResponse> {
  const createUrl = `${API_ORIGIN}/tenants/${tenantId}/finance/liquidations/draft`;
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url() === createUrl,
  );

  await page.getByRole('button', { name: 'Generar borrador' }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);

  const liquidation = (await response.json()) as LiquidationDetailResponse;
  expect(liquidation.id).toMatch(/^c[0-9a-z]{24}$/);
  await registerMutableLiquidation(liquidation.id);
  return liquidation;
}

async function openBuildingLiquidations(
  page: Page,
  tenantId: string,
  buildingId: string,
  period: string,
): Promise<void> {
  await page.goto(`/${tenantId}/buildings/${buildingId}/finance?period=${period}`);
  await expect(page.getByRole('heading', { name: 'Finanzas del edificio' })).toBeVisible();
  await page.getByRole('button', { name: 'Liquidaciones' }).click();
  await expect(page.getByRole('heading', { name: `Liquidaciones — ${period}` })).toBeVisible();
}

async function readLiquidation(
  page: Page,
  tenantId: string,
  liquidationId: string,
): Promise<LiquidationDetailResponse> {
  const response = await expectHTTPSuccess(page.request, {
    method: 'GET',
    url: liquidationUrl(tenantId, liquidationId),
    headers: financeHeaders(tenantId),
  });
  return (await response.json()) as LiquidationDetailResponse;
}

async function assertBaselineExpense(
  page: Page,
  tenantId: string,
  buildingId: string,
  period: string,
  expenseId: string,
  description: string,
): Promise<void> {
  const response = await expectHTTPSuccess(page.request, {
    method: 'GET',
    url: `${API_ORIGIN}/tenants/${tenantId}/finance/expenses?buildingId=${buildingId}&period=${period}`,
    headers: financeHeaders(tenantId),
  });
  const expenses = (await response.json()) as ExpenseResponse[];
  expect(expenses).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: expenseId, description }),
  ]));
}

async function resetAndAssertLiquidationRemoved(
  page: Page,
  tenantId: string,
  liquidationId: string,
  period: string,
  expenseId: string,
  description: string,
): Promise<void> {
  const restoredFixture = await runFin07dReset();
  expect(restoredFixture.tenantAId).toBe(fixture.tenantAId);
  expect(restoredFixture.buildingA1Id).toBe(fixture.buildingA1Id);

  await expectHTTPFailure(page.request, {
    method: 'GET',
    url: liquidationUrl(tenantId, liquidationId),
    headers: financeHeaders(tenantId),
    expectedStatus: EXPECTED_FAILURE_STATUSES.NOT_FOUND,
  });
  await assertBaselineExpense(page, tenantId, fixture.buildingA1Id, period, expenseId, description);
}

function assertCleanObservability(observability: ReturnType<typeof attachBrowserObservability>): void {
  expect(observability.pageErrors).toHaveLength(0);
  expect(observability.unexpectedConsoleErrors).toHaveLength(0);
  expect(observability.http5xx).toHaveLength(0);
  expect(observability.http401).toHaveLength(0);
}

function expectV3Breakdown(
  liquidation: LiquidationDetailResponse,
  expected: {
    readonly gross: number;
    readonly adjustments: number;
    readonly preIncome: number;
    readonly offset: number;
    readonly net: number;
  },
): void {
  expect(liquidation.valuationMode).toBe('FUNCTIONAL');
  expect(liquidation.grossExpenseAmountMinor).toBe(expected.gross);
  expect(liquidation.adjustmentAmountMinor).toBe(expected.adjustments);
  expect(liquidation.preIncomeAmountMinor).toBe(expected.preIncome);
  expect(liquidation.incomeOffsetAmountMinor).toBe(expected.offset);
  expect(liquidation.netDistributableAmountMinor).toBe(expected.net);
  expect(liquidation.totalAmountMinor).toBe(expected.net);
  expect(liquidation.baseCurrency).toBe(BASE_CURRENCY);
}

async function reviewThroughUi(page: Page, tenantId: string, liquidationId: string, period: string): Promise<void> {
  const reviewUrl = `${API_ORIGIN}/tenants/${tenantId}/finance/liquidations/${liquidationId}/review`;
  const card = liquidationCard(page, period);
  const urlBeforeReview = page.url();
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url() === reviewUrl,
  );

  await card.getByRole('button', { name: 'Revisar' }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  await expect(card.getByText('Revisada', { exact: true })).toBeVisible();
  expect(page.url()).toBe(urlBeforeReview);
}

// These two journeys mutate the same approved local fixture database. Serializing
// this describe scopes the lock to this spec and leaves unrelated Playwright suites parallel.
test.describe.serial('FIN-07D modern V3 and zero-net liquidations', () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeEach(async () => {
    releaseMutationLock = await acquireFin07dMutationLock();
    fixture = await runFin07dReset();
  });

  test.afterEach(async () => {
    try {
      await runFin07dReset();
    } finally {
      await releaseMutationLock?.();
      releaseMutationLock = undefined;
    }
  });

  test('Journey A: creates, reviews, and cleans up the 2026-06 V3 liquidation', async ({ page }) => {
    const tenantId = await loginAsFinanceAdmin(page);
    const browserContext = await resolveFinanceAdminContext(page, tenantId);
    expect(browserContext.tenantId).toBe(fixture.tenantAId);
    expect(browserContext.buildingId).toBe(fixture.buildingA1Id);
    const observability = attachBrowserObservability(page);

    try {
      await openBuildingLiquidations(page, tenantId, browserContext.buildingId, NORMAL_V3_PERIOD);
      const created = await createDraftThroughUi(page, tenantId, NORMAL_V3_PERIOD);

      expectV3Breakdown(created, {
        gross: 6000,
        adjustments: 0,
        preIncome: 6000,
        offset: 5700,
        net: 300,
      });
      expect(created.incomeOffsetsByCurrency).toEqual({ ARS: 5700 });
      expect(created.incomeOffsetSnapshot).toHaveLength(2);
      expect(created.chargesPreview).toHaveLength(5);
      expect(created.chargesPreview.map((charge) => charge.amountMinor)).toEqual([60, 60, 60, 60, 60]);

      const serverTruth = await readLiquidation(page, tenantId, created.id);
      expectV3Breakdown(serverTruth, {
        gross: 6000,
        adjustments: 0,
        preIncome: 6000,
        offset: 5700,
        net: 300,
      });
      expect(serverTruth.status).toBe('DRAFT');
      expect(serverTruth.incomeOffsetsByCurrency).toEqual({ ARS: 5700 });
      expect(serverTruth.incomeOffsetSnapshot).toHaveLength(2);
      expect(serverTruth.incomeOffsetSnapshot).toEqual(created.incomeOffsetSnapshot);

      const buildingOffset = serverTruth.incomeOffsetSnapshot?.find(
        (offset) => offset.incomeApplicationId === fixture.normalV3BuildingApplicationId,
      );
      const sharedOffset = serverTruth.incomeOffsetSnapshot?.find(
        (offset) => offset.incomeApplicationId === fixture.normalV3SharedApplicationId,
      );
      expect(buildingOffset).toMatchObject({
        scopeType: 'BUILDING',
        applicationAmountMinor: 1500,
        buildingAmountMinor: 1500,
        valuedAmountMinor: 1500,
      });
      expect(sharedOffset).toMatchObject({
        scopeType: 'TENANT_SHARED',
        applicationAmountMinor: 7000,
        buildingAmountMinor: 4200,
        valuedAmountMinor: 4200,
      });

      const persisted = await readPersistedLiquidationProof(created.id);
      expect(persisted.offsets).toHaveLength(2);
      expect(persisted.offsets).toEqual(expect.arrayContaining([
        {
          incomeApplicationId: fixture.normalV3BuildingApplicationId,
          buildingId: fixture.buildingA1Id,
          originalAmountMinor: 1500,
          valuedAmountMinor: 1500,
          currencyCode: BASE_CURRENCY,
          baseCurrency: BASE_CURRENCY,
        },
        {
          incomeApplicationId: fixture.normalV3SharedApplicationId,
          buildingId: fixture.buildingA1Id,
          originalAmountMinor: 4200,
          valuedAmountMinor: 4200,
          currencyCode: BASE_CURRENCY,
          baseCurrency: BASE_CURRENCY,
        },
      ]));

      const card = liquidationCard(page, NORMAL_V3_PERIOD);
      await expect(card).toHaveCount(1);
      await card.getByRole('button', { name: 'Ver detalle' }).click();
      const breakdown = card.getByTestId('liquidation-v3-breakdown');
      await expect(breakdown).toBeVisible();
      await expect(breakdown.getByText('Gastos brutos', { exact: true }).locator('xpath=..')).toContainText(moneyPattern(6000));
      await expect(breakdown.getByText('Ajustes', { exact: true }).locator('xpath=..')).toContainText(moneyPattern(0));
      await expect(breakdown.getByText('Subtotal', { exact: true }).locator('xpath=..')).toContainText(moneyPattern(6000));
      await expect(breakdown.getByText('Ingresos aplicados', { exact: true }).last().locator('xpath=..')).toContainText(moneyPattern(5700));
      await expect(breakdown.getByText('Neto a distribuir', { exact: true }).locator('xpath=..')).toContainText(moneyPattern(300));
      await expect(breakdown).not.toContainText(moneyPattern(8500));

      const offsetRows = breakdown.getByTestId('liquidation-offset-row');
      await expect(offsetRows).toHaveCount(2);
      await expect(offsetRows.getByText('Manual', { exact: true })).toHaveCount(2);
      const sharedOffsetRow = offsetRows.filter({ hasText: 'Aplicación total:' });
      await expect(sharedOffsetRow).toContainText(moneyPattern(7000));
      await expect(sharedOffsetRow).toContainText(moneyPattern(4200));
      await expect(offsetRows.filter({ hasNotText: 'Aplicación total:' })).toContainText(moneyPattern(1500));

      await reviewThroughUi(page, tenantId, created.id, NORMAL_V3_PERIOD);
      const reviewed = await readLiquidation(page, tenantId, created.id);
      expect(reviewed.status).toBe('REVIEWED');

      await resetAndAssertLiquidationRemoved(
        page,
        tenantId,
        created.id,
        NORMAL_V3_PERIOD,
        fixture.normalV3ExpenseId,
        NORMAL_V3_EXPENSE_DESCRIPTION,
      );
    } finally {
      observability.detach();
    }

    assertCleanObservability(observability);
  });

  test('Journey B: creates and cleans up the 2026-07 zero-net V3 liquidation', async ({ page }) => {
    const tenantId = await loginAsFinanceAdmin(page);
    const browserContext = await resolveFinanceAdminContext(page, tenantId);
    expect(browserContext.tenantId).toBe(fixture.tenantAId);
    expect(browserContext.buildingId).toBe(fixture.buildingA1Id);
    const observability = attachBrowserObservability(page);

    try {
      await openBuildingLiquidations(page, tenantId, browserContext.buildingId, ZERO_NET_PERIOD);
      const created = await createDraftThroughUi(page, tenantId, ZERO_NET_PERIOD);

      expectV3Breakdown(created, {
        gross: 5000,
        adjustments: 0,
        preIncome: 5000,
        offset: 5000,
        net: 0,
      });
      expect(created.incomeOffsetsByCurrency).toEqual({ ARS: 5000 });
      expect(created.chargesPreview).toHaveLength(5);
      expect(created.chargesPreview.every((charge) => charge.amountMinor === 0)).toBe(true);

      const serverTruth = await readLiquidation(page, tenantId, created.id);
      expectV3Breakdown(serverTruth, {
        gross: 5000,
        adjustments: 0,
        preIncome: 5000,
        offset: 5000,
        net: 0,
      });
      expect(serverTruth.incomeOffsetSnapshot).toHaveLength(1);
      expect(serverTruth.incomeOffsetSnapshot?.[0]).toMatchObject({
        incomeApplicationId: fixture.zeroNetApplicationId,
        scopeType: 'BUILDING',
        applicationAmountMinor: 5000,
        buildingAmountMinor: 5000,
        valuedAmountMinor: 5000,
      });
      expect(serverTruth.chargesPreview).toHaveLength(0);

      const persisted = await readPersistedLiquidationProof(created.id);
      expect(persisted.offsets).toEqual([{
        incomeApplicationId: fixture.zeroNetApplicationId,
        buildingId: fixture.buildingA1Id,
        originalAmountMinor: 5000,
        valuedAmountMinor: 5000,
        currencyCode: BASE_CURRENCY,
        baseCurrency: BASE_CURRENCY,
      }]);
      expect(persisted.chargeCount).toBe(0);

      const card = liquidationCard(page, ZERO_NET_PERIOD);
      await expect(card).toHaveCount(1);
      await card.getByRole('button', { name: 'Ver detalle' }).click();
      const breakdown = card.getByTestId('liquidation-v3-breakdown');
      await expect(breakdown).toBeVisible();
      await expect(breakdown.getByText('Gastos brutos', { exact: true }).locator('xpath=..')).toContainText(moneyPattern(5000));
      await expect(breakdown.getByText('Ingresos aplicados', { exact: true }).last().locator('xpath=..')).toContainText(moneyPattern(5000));
      await expect(breakdown.getByText('Neto a distribuir', { exact: true }).locator('xpath=..')).toContainText(moneyPattern(0));
      await expect(breakdown.getByTestId('liquidation-zero-net')).toBeVisible();
      await expect(breakdown).not.toContainText(/NaN/);
      await expect(breakdown).not.toContainText(/-\s*(?:\$|ARS)/);
      await expect(card).not.toContainText(/monto adeudado|amount due/i);

      await resetAndAssertLiquidationRemoved(
        page,
        tenantId,
        created.id,
        ZERO_NET_PERIOD,
        fixture.zeroNetExpenseId,
        ZERO_NET_EXPENSE_DESCRIPTION,
      );
    } finally {
      observability.detach();
    }

    assertCleanObservability(observability);
  });
});
