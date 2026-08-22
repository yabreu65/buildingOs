import { expect, test, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  attachBrowserObservability,
  acquireFin07dMutationLock,
  expectHTTPSuccess,
  loginAsFinanceAdmin,
  resolveFinanceAdminContext,
} from '../helpers';

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL?.trim() || 'http://localhost:4000';
const BASE_CURRENCY = 'ARS';
const V1_PERIOD = '2026-03';
const V2_PERIOD = '2026-02';
const NORMAL_V3_PERIOD = '2026-06';
const ZERO_NET_PERIOD = '2026-07';
const NORMAL_V3_EXPENSE_DESCRIPTION = '[FIN07D:NORMAL_V3] Expense A1 6000';
const ZERO_NET_EXPENSE_DESCRIPTION = '[FIN07D:ZERO_NET] Expense A1 5000';
const LEGACY_PERIODS = {
  auto: '2025-10',
  reserve: '2025-09',
  special: '2025-08',
  already: '2025-11',
  conflict: '2025-12',
} as const;
const runFile = promisify(execFile);
const FIN07D_RUNNER = resolve(__dirname, '../../../../api/prisma/fin07d-e2e-reset.runner.ts');
const TS_NODE_REGISTER = resolve(__dirname, '../../../../api/node_modules/ts-node/register');
const RUNNER_CWD = resolve(__dirname, '../../../../api');
let releaseMutationLock: (() => Promise<void>) | undefined;

interface Fin07dFixtureContext {
  readonly tenantAId: string;
  readonly buildingA1Id: string;
  readonly reserveFundId: string;
  readonly specialFundId: string;
  readonly normalV3ExpenseId: string;
  readonly zeroNetExpenseId: string;
  readonly historicalV1LiquidationId: string;
  readonly historicalV2LiquidationId: string;
  readonly autoMappableOffsetIncomeId: string;
  readonly requiresReserveFundIncomeId: string;
  readonly requiresSpecialFundIncomeId: string;
  readonly alreadyHasPlanIncomeId: string;
  readonly liquidationConflictIncomeId: string;
}

interface LiquidationDetailResponse {
  readonly id: string;
  readonly period: string;
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
  readonly incomeOffsetSnapshot: unknown[] | null;
  readonly publicationSnapshotStatus: 'AVAILABLE' | 'LEGACY';
  readonly chargesPreview: Array<{ readonly unitId: string; readonly amountMinor: number }>;
}

interface HistoricalProof {
  readonly liquidation: {
    readonly id: string;
    readonly period: string;
    readonly status: string;
    readonly valuationMode: string | null;
    readonly baseCurrency: string;
    readonly totalAmountMinor: number;
    readonly publicationSnapshot: Record<string, unknown>;
    readonly grossExpenseAmountMinor: number | null;
    readonly adjustmentAmountMinor: number | null;
    readonly preIncomeAmountMinor: number | null;
    readonly incomeOffsetAmountMinor: number | null;
    readonly netDistributableAmountMinor: number | null;
    readonly incomeOffsetSnapshot: unknown[] | null;
    readonly incomeOffsetsByCurrency: Record<string, number> | null;
  };
  readonly charges: Array<{
    readonly id: string;
    readonly unitId: string;
    readonly period: string;
    readonly amount: number;
    readonly currency: string;
    readonly status: string;
    readonly concept: string;
    readonly liquidationId: string;
  }>;
  readonly offsetCount: number;
}

interface LegacyPreviewItem {
  readonly incomeId: string;
  readonly period: string;
  readonly classification:
    | 'AUTO_MAPPABLE_OFFSET'
    | 'REQUIRES_RESERVE_FUND'
    | 'REQUIRES_SPECIAL_FUND'
    | 'ALREADY_HAS_PLAN'
    | 'LIQUIDATION_CONFLICT';
}

interface IncomeApplicationPlan {
  readonly applications: Array<{
    readonly id: string;
    readonly destinationType: 'OFFSET_EXPENSES' | 'FUND';
    readonly fundId: string | null;
    readonly amountMinor: number;
    readonly currencyCode: string;
    readonly policyVersionId: string | null;
    readonly legacyDestination: 'APPLY_TO_EXPENSES' | 'RESERVE_FUND' | 'SPECIAL_FUND' | null;
  }>;
}

interface FundTransaction {
  readonly direction: 'CREDIT' | 'DEBIT';
  readonly amountMinor: number;
  readonly currencyCode: string;
  readonly occurredAt: string;
  readonly incomeApplicationId: string | null;
}

interface LegacyInspect {
  readonly applications: IncomeApplicationPlan['applications'];
  readonly fundTransactions: FundTransaction[];
  readonly conflictingLiquidations: unknown[];
  readonly conflictCharges: unknown[];
}

let fixture: Fin07dFixtureContext;
let v1Before: HistoricalProof;
let v2Before: HistoricalProof;

async function runFin07d(command: string, id?: string): Promise<string> {
  const { stdout } = await runFile(
    process.execPath,
    ['-r', TS_NODE_REGISTER, FIN07D_RUNNER, command, ...(id ? [id] : [])],
    {
      cwd: RUNNER_CWD,
      env: { ...process.env, FIN07D_E2E_RESET: '1', NODE_ENV: 'development' },
    },
  );
  return stdout;
}

async function resetFin07d(): Promise<Fin07dFixtureContext> {
  return JSON.parse(await runFin07d('reset')) as Fin07dFixtureContext;
}

async function inspectHistory(liquidationId: string): Promise<HistoricalProof> {
  return JSON.parse(await runFin07d('inspect-history', liquidationId)) as HistoricalProof;
}

async function inspectLegacy(incomeId: string): Promise<LegacyInspect> {
  return JSON.parse(await runFin07d('inspect-legacy', incomeId)) as LegacyInspect;
}

function headers(tenantId: string): Record<string, string> {
  return { 'X-Tenant-Id': tenantId, 'x-portal-context': 'admin' };
}

function liquidationUrl(tenantId: string, liquidationId: string): string {
  return `${API_ORIGIN}/tenants/${tenantId}/finance/liquidations/${liquidationId}`;
}

function moneyPattern(amountMinor: number): RegExp {
  const formatted = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
  return new RegExp(formatted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

async function readLiquidation(
  page: Page,
  tenantId: string,
  liquidationId: string,
): Promise<LiquidationDetailResponse> {
  const response = await expectHTTPSuccess(page.request, {
    method: 'GET',
    url: liquidationUrl(tenantId, liquidationId),
    headers: headers(tenantId),
  });
  return (await response.json()) as LiquidationDetailResponse;
}

async function readPreview(page: Page, tenantId: string): Promise<LegacyPreviewItem[]> {
  const response = await expectHTTPSuccess(page.request, {
    method: 'GET',
    url: `${API_ORIGIN}/tenants/${tenantId}/finance/incomes/legacy-backfill/preview`,
    headers: headers(tenantId),
  });
  return (await response.json()) as LegacyPreviewItem[];
}

async function readApplications(
  page: Page,
  tenantId: string,
  incomeId: string,
): Promise<IncomeApplicationPlan> {
  const response = await expectHTTPSuccess(page.request, {
    method: 'GET',
    url: `${API_ORIGIN}/tenants/${tenantId}/finance/incomes/${incomeId}/applications`,
    headers: headers(tenantId),
  });
  return (await response.json()) as IncomeApplicationPlan;
}

async function readFundTransactions(
  page: Page,
  tenantId: string,
  fundId: string,
): Promise<FundTransaction[]> {
  const response = await expectHTTPSuccess(page.request, {
    method: 'GET',
    url: `${API_ORIGIN}/tenants/${tenantId}/finance/funds/${fundId}/transactions`,
    headers: headers(tenantId),
  });
  return (await response.json()) as FundTransaction[];
}

async function assertBaselineExpense(
  page: Page,
  tenantId: string,
  period: string,
  expenseId: string,
  description: string,
): Promise<void> {
  const response = await expectHTTPSuccess(page.request, {
    method: 'GET',
    url: `${API_ORIGIN}/tenants/${tenantId}/finance/expenses?buildingId=${fixture.buildingA1Id}&period=${period}`,
    headers: headers(tenantId),
  });
  const expenses = (await response.json()) as Array<{ id: string; description: string | null }>;
  expect(expenses).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: expenseId, description }),
  ]));
}

function expectHistoricalV3Absence(liquidation: LiquidationDetailResponse): void {
  expect(liquidation.grossExpenseAmountMinor).toBeNull();
  expect(liquidation.adjustmentAmountMinor).toBeNull();
  expect(liquidation.preIncomeAmountMinor).toBeNull();
  expect(liquidation.incomeOffsetAmountMinor).toBeNull();
  expect(liquidation.netDistributableAmountMinor).toBeNull();
  expect(liquidation.incomeOffsetsByCurrency).toBeNull();
  expect(liquidation.incomeOffsetSnapshot).toBeNull();
}

function expectCleanObservability(observability: ReturnType<typeof attachBrowserObservability>): void {
  expect(observability.pageErrors).toHaveLength(0);
  expect(observability.unexpectedConsoleErrors).toHaveLength(0);
  expect(observability.http5xx).toHaveLength(0);
  expect(observability.http401).toHaveLength(0);
}

async function openHistoricalLiquidation(
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

function historicalCard(page: Page, period: string) {
  return page.locator('div.rounded-lg.border.bg-background.shadow-sm').filter({ hasText: `Período ${period}` });
}

function expectPreviewClassification(
  preview: readonly LegacyPreviewItem[],
  incomeId: string,
  period: string,
  classification: LegacyPreviewItem['classification'],
): void {
  expect(preview.find((item) => item.incomeId === incomeId)).toMatchObject({
    incomeId,
    period,
    classification,
  });
}

// D modifies a shared local fixture database. This serial scope contains only
// C/D and leaves unrelated Playwright suites fully parallel.
test.describe.serial('FIN-07D historical liquidations and legacy backfill', () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeAll(async () => {
    releaseMutationLock = await acquireFin07dMutationLock();
    try {
      fixture = await resetFin07d();
    } catch (error: unknown) {
      await releaseMutationLock();
      releaseMutationLock = undefined;
      throw error;
    }
  });

  test.afterAll(async () => {
    try {
      await resetFin07d();
    } finally {
      await releaseMutationLock?.();
      releaseMutationLock = undefined;
    }
  });

  test('Journey C V1 preserves the published legacy liquidation without V3 provenance', async ({ page }) => {
    v1Before = await inspectHistory(fixture.historicalV1LiquidationId);
    const tenantId = await loginAsFinanceAdmin(page);
    const context = await resolveFinanceAdminContext(page, tenantId);
    expect(context.tenantId).toBe(fixture.tenantAId);
    expect(context.buildingId).toBe(fixture.buildingA1Id);
    const observability = attachBrowserObservability(page);

    try {
      const serverBefore = await readLiquidation(page, tenantId, fixture.historicalV1LiquidationId);
      expect(serverBefore).toMatchObject({
        id: fixture.historicalV1LiquidationId,
        period: V1_PERIOD,
        status: 'PUBLISHED',
        valuationMode: null,
        baseCurrency: BASE_CURRENCY,
        totalAmountMinor: 500000,
        publicationSnapshotStatus: 'AVAILABLE',
      });
      expectHistoricalV3Absence(serverBefore);
      expect(serverBefore.chargesPreview).toHaveLength(5);
      expect(serverBefore.chargesPreview.reduce((sum, charge) => sum + charge.amountMinor, 0)).toBe(500000);
      expect(v1Before.offsetCount).toBe(0);
      expect(v1Before.liquidation.publicationSnapshot.version).toBe(1);
      expect(v1Before.liquidation.publicationSnapshot.valuationMode).toBeUndefined();

      await openHistoricalLiquidation(page, tenantId, context.buildingId, V1_PERIOD);
      const card = historicalCard(page, V1_PERIOD);
      await expect(card).toHaveCount(1);
      await expect(card.getByText('Publicada', { exact: true })).toBeVisible();
      await expect(card).toContainText(moneyPattern(500000));
      await card.getByRole('button', { name: 'Ver detalle' }).click();
      await expect(card.getByTestId('liquidation-historical')).toContainText(
        'No se muestran desgloses V3 de ingresos aplicados.',
      );
      await expect(card.getByTestId('liquidation-v3-breakdown')).toHaveCount(0);
      await expect(card.getByRole('button', { name: 'Revisar' })).toHaveCount(0);
      await expect(card.getByRole('button', { name: 'Publicar' })).toHaveCount(0);

      const serverAfter = await readLiquidation(page, tenantId, fixture.historicalV1LiquidationId);
      const rawAfter = await inspectHistory(fixture.historicalV1LiquidationId);
      expect(serverAfter).toEqual(serverBefore);
      expect(rawAfter).toEqual(v1Before);
    } finally {
      observability.detach();
    }

    expectCleanObservability(observability);
  });

  test('Journey C V2 preserves frozen functional valuation without V3 offsets', async ({ page }) => {
    v2Before = await inspectHistory(fixture.historicalV2LiquidationId);
    const tenantId = await loginAsFinanceAdmin(page);
    const context = await resolveFinanceAdminContext(page, tenantId);
    const observability = attachBrowserObservability(page);

    try {
      const serverBefore = await readLiquidation(page, tenantId, fixture.historicalV2LiquidationId);
      expect(serverBefore).toMatchObject({
        id: fixture.historicalV2LiquidationId,
        period: V2_PERIOD,
        status: 'PUBLISHED',
        valuationMode: 'FUNCTIONAL',
        baseCurrency: BASE_CURRENCY,
        totalAmountMinor: 420000,
        publicationSnapshotStatus: 'AVAILABLE',
      });
      expectHistoricalV3Absence(serverBefore);
      expect(serverBefore.chargesPreview).toHaveLength(5);
      expect(serverBefore.chargesPreview.reduce((sum, charge) => sum + charge.amountMinor, 0)).toBe(420000);
      expect(v2Before.offsetCount).toBe(0);
      expect(v2Before.liquidation.publicationSnapshot.version).toBe(2);
      expect(v2Before.liquidation.publicationSnapshot.valuationMode).toBe('FUNCTIONAL');
      expect(v2Before.liquidation.publicationSnapshot.expenses).toEqual([
        expect.objectContaining({
          functionalAmountMinor: 420000,
          functionalCurrencyCode: BASE_CURRENCY,
          exchangeRateId: null,
          exchangeRateValue: null,
          exchangeRateDirection: null,
          exchangeRateEffectiveAt: null,
          conversionDate: '2026-02-01',
        }),
      ]);

      await openHistoricalLiquidation(page, tenantId, context.buildingId, V2_PERIOD);
      const card = historicalCard(page, V2_PERIOD);
      await expect(card).toHaveCount(1);
      await expect(card.getByText('Publicada', { exact: true })).toBeVisible();
      await expect(card).toContainText(moneyPattern(420000));
      await card.getByRole('button', { name: 'Ver detalle' }).click();
      await expect(card.getByTestId('liquidation-historical')).toBeVisible();
      await expect(card.getByTestId('liquidation-v3-breakdown')).toHaveCount(0);

      const serverAfter = await readLiquidation(page, tenantId, fixture.historicalV2LiquidationId);
      const rawAfter = await inspectHistory(fixture.historicalV2LiquidationId);
      expect(serverAfter).toEqual(serverBefore);
      expect(rawAfter).toEqual(v2Before);
    } finally {
      observability.detach();
    }

    expectCleanObservability(observability);
  });

  test('Journey D classifies, backfills, idempotently revisits, and resets legacy fixtures', async ({ page }) => {
    fixture = await resetFin07d();
    const tenantId = await loginAsFinanceAdmin(page);
    const observability = attachBrowserObservability(page);

    try {
      const initialPreview = await readPreview(page, tenantId);
      expectPreviewClassification(initialPreview, fixture.autoMappableOffsetIncomeId, LEGACY_PERIODS.auto, 'AUTO_MAPPABLE_OFFSET');
      expectPreviewClassification(initialPreview, fixture.requiresReserveFundIncomeId, LEGACY_PERIODS.reserve, 'REQUIRES_RESERVE_FUND');
      expectPreviewClassification(initialPreview, fixture.requiresSpecialFundIncomeId, LEGACY_PERIODS.special, 'REQUIRES_SPECIAL_FUND');
      expectPreviewClassification(initialPreview, fixture.alreadyHasPlanIncomeId, LEGACY_PERIODS.already, 'ALREADY_HAS_PLAN');
      expectPreviewClassification(initialPreview, fixture.liquidationConflictIncomeId, LEGACY_PERIODS.conflict, 'LIQUIDATION_CONFLICT');

      const alreadyBefore = await readApplications(page, tenantId, fixture.alreadyHasPlanIncomeId);
      const alreadyInspectBefore = await inspectLegacy(fixture.alreadyHasPlanIncomeId);
      const conflictBefore = await inspectLegacy(fixture.liquidationConflictIncomeId);
      expect(alreadyBefore.applications).toHaveLength(1);
      expect(alreadyInspectBefore.fundTransactions).toHaveLength(0);
      expect(conflictBefore.applications).toHaveLength(0);
      expect(conflictBefore.fundTransactions).toHaveLength(0);

      await page.goto(`/${tenantId}/finanzas?tab=incomes`);
      await page.getByRole('button', { name: 'Ingresos' }).click();
      await expect(page.getByRole('heading', { name: 'Ingresos' })).toBeVisible();
      await page.getByRole('button', { name: 'Migración histórica' }).click();
      await expect(page.getByText('Puede migrarse a Aplicar a gastos', { exact: true })).toBeVisible();
      await expect(page.getByText('Seleccione un Fondo de Reserva', { exact: true })).toBeVisible();
      await expect(page.getByText('Seleccione un Fondo Especial', { exact: true })).toBeVisible();
      await expect(page.getByText('Ya usa el modelo moderno; no se modificará', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Existe una liquidación histórica que impide migrarlo automáticamente', { exact: true })).toBeVisible();
      await expect(page.getByRole('checkbox', { name: /2025-11/ })).toHaveCount(0);
      await expect(page.getByRole('checkbox', { name: /2025-12/ })).toHaveCount(0);

      await page.getByRole('checkbox', { name: /2025-10/ }).check();
      await page.getByRole('checkbox', { name: /2025-09/ }).check();
      const applyButton = page.getByRole('button', { name: 'Aplicar migración' });
      await expect(applyButton).toBeDisabled();
      await page.getByLabel('Fondo de Reserva').selectOption(fixture.reserveFundId);
      await page.getByRole('checkbox', { name: /2025-08/ }).check();
      await expect(applyButton).toBeDisabled();
      await page.getByLabel('Fondo Especial').selectOption(fixture.specialFundId);
      await expect(applyButton).toBeEnabled();

      const applyUrl = `${API_ORIGIN}/tenants/${tenantId}/finance/incomes/legacy-backfill/apply`;
      const applyResponsePromise = page.waitForResponse(
        (response) => response.request().method() === 'POST' && response.url() === applyUrl,
      );
      await applyButton.click();
      const applyResponse = await applyResponsePromise;
      expect(applyResponse.status()).toBe(201);
      await expect(page.getByRole('status')).toContainText('3 ingresos procesados');
      await expect(page.getByRole('status')).toContainText('3 Migrados');

      const autoPlan = await readApplications(page, tenantId, fixture.autoMappableOffsetIncomeId);
      const autoInspect = await inspectLegacy(fixture.autoMappableOffsetIncomeId);
      const reservePlan = await readApplications(page, tenantId, fixture.requiresReserveFundIncomeId);
      const specialPlan = await readApplications(page, tenantId, fixture.requiresSpecialFundIncomeId);
      expect(autoPlan.applications).toEqual([expect.objectContaining({
        destinationType: 'OFFSET_EXPENSES', fundId: null, amountMinor: 2000,
        currencyCode: BASE_CURRENCY, policyVersionId: null, legacyDestination: 'APPLY_TO_EXPENSES',
      })]);
      expect(autoInspect.applications).toHaveLength(1);
      expect(autoInspect.fundTransactions).toHaveLength(0);
      expect(reservePlan.applications).toEqual([expect.objectContaining({
        destinationType: 'FUND', fundId: fixture.reserveFundId, amountMinor: 3000,
        currencyCode: BASE_CURRENCY, policyVersionId: null, legacyDestination: 'RESERVE_FUND',
      })]);
      expect(specialPlan.applications).toEqual([expect.objectContaining({
        destinationType: 'FUND', fundId: fixture.specialFundId, amountMinor: 4000,
        currencyCode: BASE_CURRENCY, policyVersionId: null, legacyDestination: 'SPECIAL_FUND',
      })]);

      const reserveTransactions = await readFundTransactions(page, tenantId, fixture.reserveFundId);
      const specialTransactions = await readFundTransactions(page, tenantId, fixture.specialFundId);
      const reserveApplication = reservePlan.applications[0];
      const specialApplication = specialPlan.applications[0];
      expect(reserveApplication).toBeTruthy();
      expect(specialApplication).toBeTruthy();
      expect(reserveTransactions.filter((transaction) => transaction.incomeApplicationId === reserveApplication?.id)).toEqual([
        expect.objectContaining({ direction: 'CREDIT', amountMinor: 3000, currencyCode: BASE_CURRENCY }),
      ]);
      expect(specialTransactions.filter((transaction) => transaction.incomeApplicationId === specialApplication?.id)).toEqual([
        expect.objectContaining({ direction: 'CREDIT', amountMinor: 4000, currencyCode: BASE_CURRENCY }),
      ]);

      const conflictResponse = await expectHTTPSuccess(page.request, {
        method: 'POST',
        url: applyUrl,
        headers: headers(tenantId),
        data: { items: [{ incomeId: fixture.liquidationConflictIncomeId }] },
      });
      expect(await conflictResponse.json()).toEqual([
        { incomeId: fixture.liquidationConflictIncomeId, status: 'LIQUIDATION_CONFLICT' },
      ]);
      const conflictAfter = await inspectLegacy(fixture.liquidationConflictIncomeId);
      expect(conflictAfter).toEqual(conflictBefore);

      const repeatResponse = await expectHTTPSuccess(page.request, {
        method: 'POST',
        url: applyUrl,
        headers: headers(tenantId),
        data: {
          items: [
            { incomeId: fixture.autoMappableOffsetIncomeId },
            { incomeId: fixture.requiresReserveFundIncomeId, fundId: fixture.reserveFundId },
            { incomeId: fixture.requiresSpecialFundIncomeId, fundId: fixture.specialFundId },
          ],
        },
      });
      const repeatResults = (await repeatResponse.json()) as Array<{ incomeId: string; status: string }>;
      expect(repeatResults).toHaveLength(3);
      expect(repeatResults.every((result) => result.status === 'ALREADY_MIGRATED')).toBe(true);
      expect((await readApplications(page, tenantId, fixture.autoMappableOffsetIncomeId)).applications).toHaveLength(1);
      expect((await readApplications(page, tenantId, fixture.requiresReserveFundIncomeId)).applications).toHaveLength(1);
      expect((await readApplications(page, tenantId, fixture.requiresSpecialFundIncomeId)).applications).toHaveLength(1);
      expect(await readApplications(page, tenantId, fixture.alreadyHasPlanIncomeId)).toEqual(alreadyBefore);
      expect(await inspectLegacy(fixture.alreadyHasPlanIncomeId)).toEqual(alreadyInspectBefore);
      expect((await readFundTransactions(page, tenantId, fixture.reserveFundId))
        .filter((transaction) => transaction.incomeApplicationId === reserveApplication?.id)).toHaveLength(1);
      expect((await readFundTransactions(page, tenantId, fixture.specialFundId))
        .filter((transaction) => transaction.incomeApplicationId === specialApplication?.id)).toHaveLength(1);

      fixture = await resetFin07d();
      const resetPreview = await readPreview(page, tenantId);
      expectPreviewClassification(resetPreview, fixture.autoMappableOffsetIncomeId, LEGACY_PERIODS.auto, 'AUTO_MAPPABLE_OFFSET');
      expectPreviewClassification(resetPreview, fixture.requiresReserveFundIncomeId, LEGACY_PERIODS.reserve, 'REQUIRES_RESERVE_FUND');
      expectPreviewClassification(resetPreview, fixture.requiresSpecialFundIncomeId, LEGACY_PERIODS.special, 'REQUIRES_SPECIAL_FUND');
      expectPreviewClassification(resetPreview, fixture.alreadyHasPlanIncomeId, LEGACY_PERIODS.already, 'ALREADY_HAS_PLAN');
      expectPreviewClassification(resetPreview, fixture.liquidationConflictIncomeId, LEGACY_PERIODS.conflict, 'LIQUIDATION_CONFLICT');
      expect(await inspectHistory(fixture.historicalV1LiquidationId)).toEqual(v1Before);
      expect(await inspectHistory(fixture.historicalV2LiquidationId)).toEqual(v2Before);
      await assertBaselineExpense(
        page,
        tenantId,
        NORMAL_V3_PERIOD,
        fixture.normalV3ExpenseId,
        NORMAL_V3_EXPENSE_DESCRIPTION,
      );
      await assertBaselineExpense(
        page,
        tenantId,
        ZERO_NET_PERIOD,
        fixture.zeroNetExpenseId,
        ZERO_NET_EXPENSE_DESCRIPTION,
      );
    } finally {
      observability.detach();
    }

    expectCleanObservability(observability);
  });
});
