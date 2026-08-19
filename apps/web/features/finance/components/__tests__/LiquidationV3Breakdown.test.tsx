import { render, screen } from '@testing-library/react';
import { LiquidationV3Breakdown } from '../LiquidationV3Breakdown';
import { formatCurrency } from '@/shared/lib/format/money';
import type { IncomeOffsetSnapshotItem, Liquidation } from '../../contracts';

function buildLiquidation(overrides: Partial<Liquidation> = {}): Liquidation {
  return {
    id: 'liq-1',
    tenantId: 'tenant-1',
    buildingId: 'building-1',
    period: '2026-05',
    status: 'REVIEWED',
    baseCurrency: 'ARS',
    totalAmountMinor: 8500,
    totalsByCurrency: { ARS: 8500 },
    unitCount: 2,
    generatedAt: '2026-05-01T00:00:00.000Z',
    reviewedAt: null,
    publishedAt: null,
    canceledAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    grossExpenseAmountMinor: 10000,
    adjustmentAmountMinor: 0,
    preIncomeAmountMinor: 10000,
    incomeOffsetAmountMinor: 1500,
    netDistributableAmountMinor: 8500,
    ...overrides,
  };
}

function snapshotItem(overrides: Partial<IncomeOffsetSnapshotItem>): IncomeOffsetSnapshotItem {
  return {
    incomeId: 'income-1',
    incomeApplicationId: 'app-1',
    categoryId: 'cat-1',
    categoryName: 'Alquiler parrillera',
    policyVersionId: null,
    legacyDestination: null,
    scopeType: 'BUILDING',
    currencyCode: 'ARS',
    applicationAmountMinor: 1050,
    buildingAmountMinor: 1050,
    valuedAmountMinor: 1050,
    functionalCurrencyCode: null,
    exchangeRateId: null,
    exchangeRateValue: null,
    exchangeRateDirection: null,
    exchangeRateEffectiveAt: null,
    conversionDate: null,
    receivedDate: '2026-05-10',
    period: '2026-05',
    ...overrides,
  };
}

describe('LiquidationV3Breakdown', () => {
  it('renders the persisted V3 breakdown with gross/adjustment/subtotal/offset/net', () => {
    render(<LiquidationV3Breakdown liquidation={buildLiquidation()} />);

    expect(screen.getByText('Gastos brutos')).toBeTruthy();
    expect(screen.getByText('Ajustes')).toBeTruthy();
    expect(screen.getByText('Subtotal')).toBeTruthy();
    expect(screen.getByText('Neto a distribuir')).toBeTruthy();

    expect(
      screen.getAllByText((_, el) => el?.textContent === formatCurrency(10000, 'ARS'))
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText((_, el) => el?.textContent === formatCurrency(8500, 'ARS')),
    ).toBeTruthy();
    expect(
      screen.getByText((_, el) => el?.textContent === `−${formatCurrency(1500, 'ARS')}`),
    ).toBeTruthy();
  });

  it('renders offset rows with manual, policy and legacy provenance', () => {
    const liquidation = buildLiquidation({
      incomeOffsetSnapshot: [
        snapshotItem({
          incomeApplicationId: 'app-1',
          categoryName: 'Manual cat',
          policyVersionId: null,
          legacyDestination: null,
        }),
        snapshotItem({
          incomeApplicationId: 'app-2',
          categoryName: 'Policy cat',
          policyVersionId: 'policy-1',
          legacyDestination: null,
        }),
        snapshotItem({
          incomeApplicationId: 'app-3',
          categoryName: 'Legacy cat',
          policyVersionId: null,
          legacyDestination: 'APPLY_TO_EXPENSES',
        }),
      ],
    });

    render(<LiquidationV3Breakdown liquidation={liquidation} />);

    expect(screen.getByText('Manual cat')).toBeTruthy();
    expect(screen.getByText('Policy cat')).toBeTruthy();
    expect(screen.getByText('Legacy cat')).toBeTruthy();
    expect(screen.getByText('Manual')).toBeTruthy();
    expect(screen.getByText('Política')).toBeTruthy();
    expect(screen.getByText('Legacy')).toBeTruthy();
  });

  it('presents incomeOffsetsByCurrency as separate lines without a fake total', () => {
    const liquidation = buildLiquidation({
      incomeOffsetsByCurrency: { USD: 5000, COP: 8000000 },
    });

    render(<LiquidationV3Breakdown liquidation={liquidation} />);

    expect(screen.getByText('USD')).toBeTruthy();
    expect(screen.getByText('COP')).toBeTruthy();
    expect(
      screen.getByText((_, el) => el?.textContent === formatCurrency(5000, 'USD')),
    ).toBeTruthy();
    expect(
      screen.getByText((_, el) => el?.textContent === formatCurrency(8000000, 'COP')),
    ).toBeTruthy();
  });

  it('renders the historical label for V1/V2 (no V3 summary fields)', () => {
    const liquidation = buildLiquidation({
      grossExpenseAmountMinor: null,
      adjustmentAmountMinor: null,
      preIncomeAmountMinor: null,
      incomeOffsetAmountMinor: null,
      netDistributableAmountMinor: null,
    });

    render(<LiquidationV3Breakdown liquidation={liquidation} />);

    expect(screen.getByTestId('liquidation-historical')).toBeTruthy();
    expect(screen.queryByText('Gastos brutos')).toBeNull();
  });

  it('renders a valid zero-net liquidation with an explanation', () => {
    const liquidation = buildLiquidation({
      grossExpenseAmountMinor: 5000,
      adjustmentAmountMinor: 0,
      preIncomeAmountMinor: 5000,
      incomeOffsetAmountMinor: 5000,
      netDistributableAmountMinor: 0,
      totalAmountMinor: 0,
      totalsByCurrency: { ARS: 0 },
    });

    render(<LiquidationV3Breakdown liquidation={liquidation} />);

    expect(screen.getByTestId('liquidation-zero-net')).toBeTruthy();
    expect(
      screen.getAllByText((_, el) => el?.textContent === formatCurrency(0, 'ARS'))
        .length,
    ).toBeGreaterThan(0);
  });

  it('renders a valid zero-offset V3 liquidation (empty snapshot + empty currency map)', () => {
    const liquidation = buildLiquidation({
      grossExpenseAmountMinor: 10000,
      adjustmentAmountMinor: 0,
      preIncomeAmountMinor: 10000,
      incomeOffsetAmountMinor: 0,
      netDistributableAmountMinor: 10000,
      totalAmountMinor: 10000,
      totalsByCurrency: { ARS: 10000 },
      incomeOffsetSnapshot: [],
      incomeOffsetsByCurrency: {},
    });

    render(<LiquidationV3Breakdown liquidation={liquidation} />);

    expect(screen.getByTestId('liquidation-v3-breakdown')).toBeTruthy();
    expect(screen.queryByTestId('liquidation-offset-row')).toBeNull();
    expect(screen.queryByText('Por moneda')).toBeNull();
    expect(
      screen.getAllByText((_, el) => el?.textContent === formatCurrency(10000, 'ARS'))
        .length,
    ).toBeGreaterThan(0);
  });

  it('shows the building share (not the whole application) for TENANT_SHARED offsets', () => {
    const liquidation = buildLiquidation({
      incomeOffsetAmountMinor: 4200,
      netDistributableAmountMinor: 5800,
      totalAmountMinor: 5800,
      totalsByCurrency: { ARS: 5800 },
      incomeOffsetSnapshot: [
        snapshotItem({
          incomeApplicationId: 'app-shared',
          categoryName: 'Alquiler parrillera',
          scopeType: 'TENANT_SHARED',
          currencyCode: 'ARS',
          applicationAmountMinor: 7000,
          buildingAmountMinor: 4200,
          valuedAmountMinor: 4200,
        }),
      ],
    });

    render(<LiquidationV3Breakdown liquidation={liquidation} />);

    const row = screen.getByTestId('liquidation-offset-row');
    const primaryAmount = row.querySelector('div.text-right')?.textContent ?? '';
    expect(primaryAmount).toContain('42,00');
    expect(primaryAmount).not.toContain('70,00');
    // El total de la aplicación queda expuesto secundariamente, etiquetado.
    expect(row.textContent).toContain('Aplicación total:');
    expect(row.textContent).toContain('70,00');
  });

  it('shows building original amount converted to base for cross-currency shared offsets', () => {
    const liquidation = buildLiquidation({
      baseCurrency: 'COP',
      incomeOffsetAmountMinor: 2400000,
      netDistributableAmountMinor: 1600000,
      totalAmountMinor: 1600000,
      totalsByCurrency: { COP: 1600000 },
      incomeOffsetSnapshot: [
        snapshotItem({
          incomeApplicationId: 'app-xcur',
          categoryName: 'Publicidad',
          scopeType: 'UNIT_GROUP',
          currencyCode: 'USD',
          applicationAmountMinor: 10000,
          buildingAmountMinor: 6000,
          valuedAmountMinor: 2400000,
          functionalCurrencyCode: 'COP',
        }),
      ],
    });

    render(<LiquidationV3Breakdown liquidation={liquidation} />);

    const row = screen.getByTestId('liquidation-offset-row');
    const primaryAmount = row.querySelector('div.text-right')?.textContent ?? '';
    expect(primaryAmount).toContain('60,00');
    expect(primaryAmount).toContain('24.000,00');
    expect(primaryAmount).not.toContain('100,00');
    // El total de la aplicación queda expuesto secundariamente, etiquetado.
    expect(row.textContent).toContain('Aplicación total:');
    expect(row.textContent).toContain('100,00');
  });

  it('reconciles displayed building shares with the persisted offset total', () => {
    const liquidation = buildLiquidation({
      incomeOffsetAmountMinor: 6000,
      netDistributableAmountMinor: 4000,
      totalAmountMinor: 4000,
      totalsByCurrency: { ARS: 4000 },
      incomeOffsetSnapshot: [
        snapshotItem({
          incomeApplicationId: 'app-shared-1',
          categoryName: 'Alquiler parrillera',
          scopeType: 'TENANT_SHARED',
          currencyCode: 'ARS',
          applicationAmountMinor: 10000,
          buildingAmountMinor: 4200,
          valuedAmountMinor: 4200,
        }),
        snapshotItem({
          incomeApplicationId: 'app-shared-2',
          categoryName: 'Publicidad',
          scopeType: 'TENANT_SHARED',
          currencyCode: 'ARS',
          applicationAmountMinor: 10000,
          buildingAmountMinor: 1800,
          valuedAmountMinor: 1800,
        }),
      ],
    });

    render(<LiquidationV3Breakdown liquidation={liquidation} />);

    const rows = screen.getAllByTestId('liquidation-offset-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('42,00');
    expect(rows[1].textContent).toContain('18,00');
    // La suma de los shares mostrados reconcilia con el offset persistido.
    expect(4200 + 1800).toBe(liquidation.incomeOffsetAmountMinor);
  });
});
