import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  attachBrowserObservability,
  expectNoHorizontalOverflow,
  loginAsFinanceAdmin,
  resolveFinanceAdminContext,
  setViewport,
} from '../helpers';

const VIEWPORTS = ['mobile', 'tablet', 'desktop'] as const;
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL?.trim() || 'http://localhost:4000';
const runFile = promisify(execFile);
const RUNNER = resolve(__dirname, '../../../../api/prisma/fin07d-e2e-reset.runner.ts');
const TS_NODE_REGISTER = resolve(__dirname, '../../../../api/node_modules/ts-node/register');
const RUNNER_CWD = resolve(__dirname, '../../../../api');

interface FixtureContext { readonly buildingA1Id: string; }

interface DenseTableMetrics {
  readonly tableScrollWidth: number;
  readonly tableClientWidth: number;
  readonly containerScrollWidth: number;
  readonly containerClientWidth: number;
  readonly containerOverflowX: string;
  readonly documentScrollWidth: number;
  readonly documentClientWidth: number;
}

async function runner(command: string, id?: string): Promise<string> {
  const { stdout } = await runFile(process.execPath, ['-r', TS_NODE_REGISTER, RUNNER, command, ...(id ? [id] : [])], {
    cwd: RUNNER_CWD,
    env: { ...process.env, FIN07D_E2E_RESET: '1', NODE_ENV: 'development' },
  });
  return stdout;
}

async function reset(): Promise<FixtureContext> {
  return JSON.parse(await runner('reset')) as FixtureContext;
}

function money(amountMinor: number): RegExp {
  const value = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amountMinor / 100);
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

function assertClean(observability: ReturnType<typeof attachBrowserObservability>): void {
  expect(observability.pageErrors).toHaveLength(0);
  expect(observability.consoleErrors).toHaveLength(0);
  expect(observability.http5xx).toHaveLength(0);
  expect(observability.http401).toHaveLength(0);
}

async function assertDenseTableContained(page: Parameters<typeof setViewport>[0], viewport: 'mobile' | 'tablet'): Promise<void> {
  const table = page.getByRole('table');
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr').first()).toBeVisible();
  const metrics = await table.evaluate((element) => {
    const container = element.parentElement;
    if (!container) throw new Error('Finance dense table has no scroll container');
    const root = document.documentElement;
    return {
      tableScrollWidth: element.scrollWidth,
      tableClientWidth: element.clientWidth,
      containerScrollWidth: container.scrollWidth,
      containerClientWidth: container.clientWidth,
      containerOverflowX: window.getComputedStyle(container).overflowX,
      documentScrollWidth: root.scrollWidth,
      documentClientWidth: root.clientWidth,
    };
  }) as DenseTableMetrics;
  expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.documentClientWidth);
  if (metrics.tableScrollWidth > metrics.containerClientWidth) {
    expect(metrics.containerOverflowX).toMatch(/auto|scroll/);
    expect(metrics.containerScrollWidth).toBeGreaterThan(metrics.containerClientWidth);
  } else {
    expect(metrics.tableScrollWidth).toBeLessThanOrEqual(metrics.containerClientWidth);
  }
  console.log(`FIN07D_${viewport.toUpperCase()}_DENSE_TABLE=${JSON.stringify(metrics)}`);
}

test.describe('FIN-07D responsive finance surfaces', () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport} keeps finance dashboard, tabs, and liquidation history within page bounds`, async ({ page }) => {
      const tenantId = await loginAsFinanceAdmin(page);
      const context = await resolveFinanceAdminContext(page, tenantId);
      await setViewport(page, viewport);
      const observability = attachBrowserObservability(page);
      try {
        await page.goto(`/${tenantId}/finanzas?tab=incomes`);
        await expect(page.getByRole('heading', { name: 'Ingresos' })).toBeVisible();
        await expectNoHorizontalOverflow(page);
        for (const tab of ['funds', 'policies'] as const) {
          await page.getByRole('button', { name: tab === 'funds' ? 'Fondos' : 'Políticas de ingreso' }).click();
          await expectNoHorizontalOverflow(page);
        }
        await page.goto(`/${tenantId}/buildings/${context.buildingId}/finance?period=2026-03`);
        await page.getByRole('button', { name: 'Liquidaciones' }).click();
        const card = page.locator('div.rounded-lg.border.bg-background.shadow-sm').filter({ hasText: 'Período 2026-03' });
        await card.getByRole('button', { name: 'Ver detalle' }).click();
        await expect(card.getByTestId('liquidation-historical')).toBeVisible();
        await expectNoHorizontalOverflow(page);
      } finally {
        observability.detach();
      }
      assertClean(observability);
    });
  }

  test('mobile keeps legacy backfill controls reachable', async ({ page }) => {
    const tenantId = await loginAsFinanceAdmin(page);
    await setViewport(page, 'mobile');
    const observability = attachBrowserObservability(page);
    try {
    await page.goto(`/${tenantId}/finanzas?tab=incomes`);
    await page.getByRole('button', { name: 'Migración histórica' }).click();
    await expect(page.getByText('Puede migrarse a Aplicar a gastos', { exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: /2025-09/ }).check();
    await expect(page.getByText('Seleccione un Fondo de Reserva', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Fondo de Reserva')).toBeVisible();
    await expect(page.getByLabel('Fondo de Reserva').locator('option:not([value=""])')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Aplicar migración' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    } finally {
      observability.detach();
    }
    assertClean(observability);
  });

  for (const viewport of ['mobile', 'tablet'] as const) {
    test(`${viewport} contains its dense expense table internally`, async ({ page }) => {
      const tenantId = await loginAsFinanceAdmin(page);
      const context = await resolveFinanceAdminContext(page, tenantId);
      await setViewport(page, viewport);
      const observability = attachBrowserObservability(page);
      try {
        await page.goto(`/${tenantId}/buildings/${context.buildingId}/finance?period=2026-06`);
        await page.getByRole('button', { name: 'Gastos del edificio' }).click();
        await assertDenseTableContained(page, viewport);
      } finally {
        observability.detach();
      }
      assertClean(observability);
    });
  }

  test('mobile modal and desktop retain the disposable V3 equation', async ({ page }) => {
    const fixture = await reset();
    const tenantId = await loginAsFinanceAdmin(page);
    const observability = attachBrowserObservability(page);
    try {
      await setViewport(page, 'mobile');
      await page.goto(`/${tenantId}/buildings/${fixture.buildingA1Id}/finance?period=2026-06`);
      await page.getByRole('button', { name: 'Liquidaciones' }).click();
      const createUrl = `${API_ORIGIN}/tenants/${tenantId}/finance/liquidations/draft`;
      const createdResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url() === createUrl);
      await page.getByRole('button', { name: 'Generar borrador' }).click();
      const created = await (await createdResponse).json() as { id: string };
      await runner('register', created.id);
      const card = page.locator('div.rounded-lg.border.bg-background.shadow-sm').filter({ hasText: 'Período 2026-06' });
      await card.getByRole('button', { name: 'Ver detalle' }).click();
      const breakdown = card.getByTestId('liquidation-v3-breakdown');
      await expect(breakdown).toContainText(money(6000));
      await expect(breakdown.getByText('Ingresos aplicados', { exact: true }).last().locator('xpath=..')).toContainText(money(5700));
      await expect(breakdown.getByText('Neto a distribuir', { exact: true }).locator('xpath=..')).toContainText(money(300));
      await card.getByRole('button', { name: 'Revisar' }).click();
      await expect(card.getByRole('button', { name: 'Publicar' })).toBeVisible();
      await card.getByRole('button', { name: 'Publicar' }).click();
      const dialog = page.getByRole('dialog', { name: 'Publicar liquidación' });
      await expect(dialog).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expect(dialog.getByRole('button', { name: /cancelar/i })).toBeVisible();
      await dialog.getByRole('button', { name: /cancelar/i }).click();
      await expect(dialog).toHaveCount(0);
      await setViewport(page, 'desktop');
      await expectNoHorizontalOverflow(page);
      await expect(breakdown).toContainText(money(6000));
      await expect(breakdown.getByText('Ingresos aplicados', { exact: true }).last().locator('xpath=..')).toContainText(money(5700));
      await expect(breakdown.getByText('Neto a distribuir', { exact: true }).locator('xpath=..')).toContainText(money(300));
    } finally {
      await reset();
      observability.detach();
    }
    assertClean(observability);
  });
});
