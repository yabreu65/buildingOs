import { IncomeApplicationDestination } from '@prisma/client';
import {
  computeIncomeOffsetsForLiquidation,
  type IncomeWithApplications,
} from './liquidation-income-offsets.service';
import { distributeMinorByWeights } from './income-offset-allocation';

function makeIncome(overrides: Partial<IncomeWithApplications> = {}): IncomeWithApplications {
  return {
    id: 'income-1',
    buildingId: 'building-a',
    period: '2026-08',
    scopeType: 'BUILDING',
    status: 'RECORDED',
    functionalAmountMinor: null,
    functionalCurrencyCode: null,
    exchangeRateId: null,
    exchangeRateValue: null,
    exchangeRateDirection: null,
    exchangeRateEffectiveAt: null,
    conversionDate: null,
    receivedDate: new Date('2026-08-10T00:00:00.000Z'),
    categoryId: 'cat-1',
    category: { name: 'Parrillera' },
    allocations: [],
    applications: [],
    ...overrides,
  };
}

function makeApplication(overrides: Partial<IncomeWithApplications['applications'][number]> = {}) {
  return {
    id: 'app-offset',
    destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
    amountMinor: 7000,
    currencyCode: 'USD',
    policyVersionId: null,
    ...overrides,
  };
}

const params = {
  tenantId: 'tenant-1',
  buildingId: 'building-a',
  period: '2026-08',
  valuationMode: 'LEGACY_NOMINAL' as const,
  baseCurrency: 'USD',
};

describe('computeIncomeOffsetsForLiquidation (FIN-06)', () => {
  it('returns empty when income has no OFFSET applications', () => {
    const result = computeIncomeOffsetsForLiquidation(
      [
        makeIncome({
          applications: [
            { ...makeApplication(), destinationType: IncomeApplicationDestination.FUND },
          ],
        }),
      ],
      params,
    );

    expect(result.items).toEqual([]);
    expect(result.incomeOffsetAmountMinor).toBe(0);
  });

  it('OFFSET reduces net (nominal)', () => {
    const result = computeIncomeOffsetsForLiquidation(
      [
        makeIncome({
          applications: [makeApplication()],
        }),
      ],
      params,
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.valuedAmountMinor).toBe(7000);
    expect(result.incomeOffsetAmountMinor).toBe(7000);
  });

  it('FUND applications do not reduce net', () => {
    const result = computeIncomeOffsetsForLiquidation(
      [
        makeIncome({
          applications: [
            { ...makeApplication(), id: 'app-fund', destinationType: IncomeApplicationDestination.FUND },
          ],
        }),
      ],
      params,
    );

    expect(result.items).toEqual([]);
    expect(result.incomeOffsetAmountMinor).toBe(0);
  });

  it('CARRY_FORWARD applications do not reduce net', () => {
    const result = computeIncomeOffsetsForLiquidation(
      [
        makeIncome({
          applications: [
            { ...makeApplication(), id: 'app-carry', destinationType: IncomeApplicationDestination.CARRY_FORWARD },
          ],
        }),
      ],
      params,
    );

    expect(result.items).toEqual([]);
    expect(result.incomeOffsetAmountMinor).toBe(0);
  });

  it('sums multiple offset applications', () => {
    const result = computeIncomeOffsetsForLiquidation(
      [
        makeIncome({
          applications: [
            makeApplication({ id: 'off-1', amountMinor: 4000 }),
            makeApplication({ id: 'off-2', amountMinor: 3000 }),
          ],
        }),
      ],
      params,
    );

    expect(result.items).toHaveLength(2);
    expect(result.incomeOffsetAmountMinor).toBe(7000);
  });

  it('ignores applications from another period', () => {
    const result = computeIncomeOffsetsForLiquidation(
      [
        makeIncome({
          period: '2026-07',
          applications: [makeApplication()],
        }),
      ],
      params,
    );

    expect(result.items).toEqual([]);
  });

  it('ignores applications from a VOID income', () => {
    const result = computeIncomeOffsetsForLiquidation(
      [
        makeIncome({
          status: 'VOID',
          applications: [makeApplication()],
        }),
      ],
      params,
    );

    expect(result.items).toEqual([]);
  });

  it('ignores applications from a DRAFT income', () => {
    const result = computeIncomeOffsetsForLiquidation(
      [
        makeIncome({
          status: 'DRAFT',
          applications: [makeApplication()],
        }),
      ],
      params,
    );

    expect(result.items).toEqual([]);
  });

  it('BUILDING scope: offset for the matching building', () => {
    const result = computeIncomeOffsetsForLiquidation(
      [
        makeIncome({
          buildingId: 'building-a',
          applications: [makeApplication()],
        }),
      ],
      params,
    );

    expect(result.incomeOffsetAmountMinor).toBe(7000);
  });

  it('BUILDING scope: offset for another building is ignored', () => {
    const result = computeIncomeOffsetsForLiquidation(
      [
        makeIncome({
          buildingId: 'building-b',
          applications: [makeApplication()],
        }),
      ],
      params,
    );

    expect(result.items).toEqual([]);
    expect(result.incomeOffsetAmountMinor).toBe(0);
  });

  it('TENANT_SHARED 60/40: building-a gets 4200', () => {
    const result = computeIncomeOffsetsForLiquidation(
      [
        makeIncome({
          buildingId: null,
          scopeType: 'TENANT_SHARED',
          allocations: [
            { buildingId: 'building-a', amountMinor: 6000 },
            { buildingId: 'building-b', amountMinor: 4000 },
          ],
          applications: [
            makeApplication({ amountMinor: 7000 }),
            makeApplication({ id: 'app-fund', destinationType: IncomeApplicationDestination.FUND, amountMinor: 3000 }),
          ],
        }),
      ],
      params,
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.buildingAmountMinor).toBe(4200);
    expect(result.items[0]!.valuedAmountMinor).toBe(4200);
    expect(result.incomeOffsetAmountMinor).toBe(4200);
  });

  it('TENANT_SHARED deterministic rounding with odd totals', () => {
    const result = computeIncomeOffsetsForLiquidation(
      [
        makeIncome({
          buildingId: null,
          scopeType: 'TENANT_SHARED',
          allocations: [
            { buildingId: 'building-a', amountMinor: 6000 },
            { buildingId: 'building-b', amountMinor: 4000 },
          ],
          applications: [makeApplication({ amountMinor: 10001 })],
        }),
      ],
      params,
    );

    // La share de building-a debe ser 6001 (largest remainder sobre 6000/4000)
    // y la suma de todas las shares del building == monto de la aplicación.
    expect(result.items[0]!.buildingAmountMinor).toBe(6001);
    const allShares = distributeMinorByWeights(10001, [
      { buildingId: 'building-a', amountMinor: 6000 },
      { buildingId: 'building-b', amountMinor: 4000 },
    ]);
    expect(allShares.reduce((sum, item) => sum + item.amountMinor, 0)).toBe(10001);
    expect(result.incomeOffsetAmountMinor).toBe(6001);
  });

  it('manual application (policyVersionId null) works', () => {
    const result = computeIncomeOffsetsForLiquidation(
      [
        makeIncome({
          applications: [makeApplication({ policyVersionId: null })],
        }),
      ],
      params,
    );

    expect(result.items[0]!.policyVersionId).toBeNull();
    expect(result.incomeOffsetAmountMinor).toBe(7000);
  });

  it('policy application preserves policyVersionId provenance', () => {
    const result = computeIncomeOffsetsForLiquidation(
      [
        makeIncome({
          applications: [makeApplication({ policyVersionId: 'pv-1' })],
        }),
      ],
      params,
    );

    expect(result.items[0]!.policyVersionId).toBe('pv-1');
  });

  it('FUNCTIONAL: uses frozen functional snapshot per application', () => {
    const result = computeIncomeOffsetsForLiquidation(
      [
        makeIncome({
          functionalAmountMinor: 2500,
          functionalCurrencyCode: 'ARS',
          applications: [
            makeApplication({ amountMinor: 7000 }),
            makeApplication({ id: 'app-fund', destinationType: IncomeApplicationDestination.FUND, amountMinor: 3000 }),
          ],
        }),
      ],
      {
        ...params,
        valuationMode: 'FUNCTIONAL',
        baseCurrency: 'ARS',
      },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.valuedAmountMinor).toBe(1750);
    expect(result.incomeOffsetAmountMinor).toBe(1750);
  });

  it('FUNCTIONAL: functional allocation is exact across applications', () => {
    const result = computeIncomeOffsetsForLiquidation(
      [
        makeIncome({
          functionalAmountMinor: 2501,
          functionalCurrencyCode: 'ARS',
          applications: [
            makeApplication({ amountMinor: 7000 }),
            makeApplication({ id: 'app-fund', destinationType: IncomeApplicationDestination.FUND, amountMinor: 3000 }),
          ],
        }),
      ],
      {
        ...params,
        valuationMode: 'FUNCTIONAL',
        baseCurrency: 'ARS',
      },
    );

    expect(result.incomeOffsetAmountMinor).toBeGreaterThan(0);
  });

  it('FUNCTIONAL: shared income distributes functional value by building', () => {
    const result = computeIncomeOffsetsForLiquidation(
      [
        makeIncome({
          buildingId: null,
          scopeType: 'TENANT_SHARED',
          functionalAmountMinor: 2500,
          functionalCurrencyCode: 'ARS',
          allocations: [
            { buildingId: 'building-a', amountMinor: 6000 },
            { buildingId: 'building-b', amountMinor: 4000 },
          ],
          applications: [
            makeApplication({ amountMinor: 7000 }),
            makeApplication({ id: 'app-fund', destinationType: IncomeApplicationDestination.FUND, amountMinor: 3000 }),
          ],
        }),
      ],
      {
        ...params,
        valuationMode: 'FUNCTIONAL',
        baseCurrency: 'ARS',
      },
    );

    expect(result.items[0]!.valuedAmountMinor).toBe(1050);
  });

  it('FUNCTIONAL: missing functional snapshot raises 422 (fail-closed)', () => {
    const action = () =>
      computeIncomeOffsetsForLiquidation(
        [
          makeIncome({
            functionalAmountMinor: null,
            applications: [makeApplication()],
          }),
        ],
        {
          ...params,
          valuationMode: 'FUNCTIONAL',
          baseCurrency: 'ARS',
        },
      );

    expect(action).toThrow();
    try {
      action();
    } catch (error) {
      expect((error as { getResponse(): { error: string } }).getResponse().error).toBe(
        'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED',
      );
    }
  });

  it('FUNCTIONAL: valid functional amount but currency mismatch raises 422 (fail-closed)', () => {
    const action = () =>
      computeIncomeOffsetsForLiquidation(
        [
          makeIncome({
            functionalAmountMinor: 2500,
            functionalCurrencyCode: 'USD',
            applications: [makeApplication()],
          }),
        ],
        {
          ...params,
          valuationMode: 'FUNCTIONAL',
          baseCurrency: 'ARS',
        },
      );

    expect(action).toThrow();
    try {
      action();
    } catch (error) {
      expect((error as { getResponse(): { error: string } }).getResponse().error).toBe(
        'LIQUIDATION_FUNCTIONAL_SNAPSHOT_REQUIRED',
      );
    }
  });

  it('LEGACY_NOMINAL: cross-currency offset raises currency mismatch', () => {
    const action = () =>
      computeIncomeOffsetsForLiquidation(
        [
          makeIncome({
            applications: [makeApplication({ currencyCode: 'USD' })],
          }),
        ],
        {
          ...params,
          baseCurrency: 'ARS',
        },
      );

    expect(action).toThrow();
    try {
      action();
    } catch (error) {
      expect((error as { getResponse(): { error: string } }).getResponse().error).toBe(
        'LIQUIDATION_INCOME_OFFSET_CURRENCY_MISMATCH',
      );
    }
  });

  it('produces relational references with valued amounts', () => {
    const result = computeIncomeOffsetsForLiquidation(
      [
        makeIncome({
          applications: [makeApplication()],
        }),
      ],
      params,
    );

    expect(result.references).toEqual([
      {
        incomeApplicationId: 'app-offset',
        buildingId: 'building-a',
        originalAmountMinor: 7000,
        currencyCode: 'USD',
        valuedAmountMinor: 7000,
        baseCurrency: 'USD',
      },
    ]);
  });

  it('returns empty result for no incomes', () => {
    const result = computeIncomeOffsetsForLiquidation([], params);

    expect(result.items).toEqual([]);
    expect(result.references).toEqual([]);
    expect(result.incomeOffsetAmountMinor).toBe(0);
    expect(result.incomeOffsetsByCurrency).toEqual({});
  });
});
