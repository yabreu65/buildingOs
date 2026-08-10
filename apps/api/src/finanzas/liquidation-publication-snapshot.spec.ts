import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import {
  assertLiquidationMovementCurrency,
  buildLiquidationPublicationSnapshot,
  distributeLiquidationAmountByLargestRemainder,
  parseLiquidationPublicationSnapshot,
} from './liquidation-publication-snapshot';

describe('liquidation publication snapshot', () => {
  const baseInput = {
    liquidationId: 'liq-1',
    tenantId: 'tenant-1',
    buildingId: 'building-1',
    period: '2026-05',
    baseCurrency: 'ARS',
    totalAmountMinor: 100,
    totalsByCurrency: { ARS: 100 },
    valuationMode: 'LEGACY_NOMINAL' as const,
    expenses: [
      {
        expenseId: 'exp-1',
        categoryName: 'Water',
        vendorName: 'Vendor',
        amountMinor: 100,
        currencyCode: 'ARS',
        invoiceDate: '2026-05-01T00:00:00.000Z',
        description: null,
        type: 'EXPENSE' as const,
      },
    ],
    allocations: [
      {
        unitId: 'unit-1',
        unitCode: '1A',
        unitLabel: '1A',
        amountMinor: 100,
      },
    ],
    dueDate: new Date('2026-06-10T00:00:00.000Z'),
    publishedAt: new Date('2026-07-12T00:00:00.000Z'),
  };

  it('builds and parses a valid snapshot', () => {
    const snapshot = buildLiquidationPublicationSnapshot(baseInput);
    const parsed = parseLiquidationPublicationSnapshot(snapshot);

    expect(parsed).toMatchObject({
      version: 1,
      liquidationId: 'liq-1',
      baseCurrency: 'ARS',
      totalAmountMinor: 100,
      totalsByCurrency: { ARS: 100 },
    });
  });

  it('builds a snapshot from an exact Largest Remainder repartition', () => {
    const distributed = distributeLiquidationAmountByLargestRemainder(
      [
        { id: 'unit-b', code: 'B-201', label: '201', areaM2: 1 },
        { id: 'unit-a', code: 'A-101', label: '101', areaM2: 1 },
        { id: 'unit-c', code: 'C-301', label: '301', areaM2: 1 },
      ],
      100,
    );

    expect(distributed.map((allocation) => allocation.amountMinor)).toEqual([34, 33, 33]);
    expect(distributed.every((allocation) => Number.isInteger(allocation.amountMinor) && allocation.amountMinor >= 0)).toBe(true);
    expect(distributed.reduce((sum, allocation) => sum + allocation.amountMinor, 0)).toBe(100);

    const snapshot = buildLiquidationPublicationSnapshot({
      ...baseInput,
      allocations: distributed.map(({ unitId, unitCode, unitLabel, amountMinor }) => ({
        unitId,
        unitCode,
        unitLabel,
        amountMinor,
      })),
    });

    expect(snapshot.allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ unitId: 'unit-a', amountMinor: 34 }),
        expect.objectContaining({ unitId: 'unit-b', amountMinor: 33 }),
        expect.objectContaining({ unitId: 'unit-c', amountMinor: 33 }),
      ]),
    );
  });

  it.each([
    {
      name: 'baseCurrency absent',
      input: { ...baseInput, baseCurrency: 'USD', totalsByCurrency: { ARS: 100 } },
    },
    {
      name: 'baseCurrency total mismatch',
      input: { ...baseInput, totalAmountMinor: 101 },
    },
    {
      name: 'allocations below total',
      input: { ...baseInput, allocations: [{ ...baseInput.allocations[0], amountMinor: 99 }] },
    },
    {
      name: 'allocations above total',
      input: { ...baseInput, allocations: [{ ...baseInput.allocations[0], amountMinor: 101 }] },
    },
    {
      name: 'decimal amount',
      input: { ...baseInput, totalAmountMinor: 100.5 },
    },
    {
      name: 'negative amount',
      input: { ...baseInput, totalAmountMinor: -1 },
    },
    {
      name: 'overflow amount',
      input: { ...baseInput, totalAmountMinor: Number.MAX_SAFE_INTEGER + 1 },
    },
    {
      name: 'financially inconsistent snapshot',
      input: {
        ...baseInput,
        expenses: [
          {
            ...baseInput.expenses[0],
            amountMinor: 50,
          },
        ],
      },
    },
  ])('rejects $name', ({ input }) => {
    expect(() => buildLiquidationPublicationSnapshot(input)).toThrow(BadRequestException);
  });

  it.each([
    {
      name: '100 distributed across 3 equal units',
      totalAmountMinor: 100,
      units: [
        { id: 'unit-c', code: 'C', label: 'C', areaM2: 1 },
        { id: 'unit-a', code: 'A', label: 'A', areaM2: 1 },
        { id: 'unit-b', code: 'B', label: 'B', areaM2: 1 },
      ],
      amounts: [34, 33, 33],
    },
    {
      name: '1 distributed across 3 equal units',
      totalAmountMinor: 1,
      units: [
        { id: 'unit-c', code: 'C', label: 'C', areaM2: 1 },
        { id: 'unit-a', code: 'A', label: 'A', areaM2: 1 },
        { id: 'unit-b', code: 'B', label: 'B', areaM2: 1 },
      ],
      amounts: [1, 0, 0],
    },
    {
      name: 'different areas stay proportional',
      totalAmountMinor: 100,
      units: [
        { id: 'unit-a', code: 'A', label: 'A', areaM2: 1 },
        { id: 'unit-b', code: 'B', label: 'B', areaM2: 2 },
        { id: 'unit-c', code: 'C', label: 'C', areaM2: 3 },
      ],
      amounts: [17, 33, 50],
    },
    {
      name: 'all zero total stays zero',
      totalAmountMinor: 0,
      units: [
        { id: 'unit-a', code: 'A', label: 'A', areaM2: 1 },
        { id: 'unit-b', code: 'B', label: 'B', areaM2: 1 },
      ],
      amounts: [0, 0],
    },
    {
      name: 'one unit gets all when others have zero area',
      totalAmountMinor: 9,
      units: [
        { id: 'unit-a', code: 'A', label: 'A', areaM2: 3 },
        { id: 'unit-b', code: 'B', label: 'B', areaM2: 0 },
        { id: 'unit-c', code: 'C', label: 'C', areaM2: 0 },
      ],
      amounts: [9, 0, 0],
    },
  ])('distributes exact cents for $name', ({ totalAmountMinor, units, amounts }) => {
    const allocations = distributeLiquidationAmountByLargestRemainder(units, totalAmountMinor);

    expect(allocations.map((allocation) => allocation.amountMinor)).toEqual(amounts);
    expect(allocations.every((allocation) => Number.isInteger(allocation.amountMinor) && allocation.amountMinor >= 0)).toBe(true);
    expect(allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0)).toBe(totalAmountMinor);
  });

  it('rejects a structurally valid but financially inconsistent parsed snapshot', () => {
    expect(() =>
      parseLiquidationPublicationSnapshot({
        version: 1,
        liquidationId: 'liq-1',
        tenantId: 'tenant-1',
        buildingId: 'building-1',
        period: '2026-05',
        baseCurrency: 'ARS',
        totalAmountMinor: 100,
        totalsByCurrency: { ARS: 100 },
        expenses: [
          {
            expenseId: 'exp-1',
            categoryName: 'Water',
            vendorName: 'Vendor',
            amountMinor: 40,
            currencyCode: 'ARS',
            invoiceDate: '2026-05-01T00:00:00.000Z',
            description: null,
            type: 'EXPENSE',
          },
        ],
        allocations: [
          {
            unitId: 'unit-1',
            unitCode: '1A',
            unitLabel: '1A',
            amountMinor: 100,
          },
        ],
        dueDate: '2026-06-10T00:00:00.000Z',
        publishedAt: '2026-07-12T00:00:00.000Z',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects aggregate overflow in expense totals', () => {
    expect(() =>
      buildLiquidationPublicationSnapshot({
        ...baseInput,
        expenses: [
          {
            ...baseInput.expenses[0],
            amountMinor: Number.MAX_SAFE_INTEGER,
          },
          {
            ...baseInput.expenses[0],
            expenseId: 'exp-2',
            amountMinor: 1,
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects aggregate overflow in allocation totals', () => {
    expect(() =>
      buildLiquidationPublicationSnapshot({
        ...baseInput,
        allocations: [
          {
            ...baseInput.allocations[0],
            amountMinor: Number.MAX_SAFE_INTEGER,
          },
          {
            ...baseInput.allocations[0],
            unitId: 'unit-2',
            unitCode: '1B',
            amountMinor: 1,
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  describe('valuation mode aware guards', () => {
    it('FUNCTIONAL allows different original currencies converging to base', () => {
      expect(() =>
        assertLiquidationMovementCurrency(
          [
            { currencyCode: 'USD', functionalAmountMinor: 36500, functionalCurrencyCode: 'VES' },
            { currencyCode: 'COP', functionalAmountMinor: 125, functionalCurrencyCode: 'VES' },
          ],
          'VES',
          'FUNCTIONAL',
        ),
      ).not.toThrow();
    });

    it('FUNCTIONAL rejects a movement without functional amount', () => {
      expect(() =>
        assertLiquidationMovementCurrency(
          [{ currencyCode: 'USD', functionalAmountMinor: null, functionalCurrencyCode: null }],
          'VES',
          'FUNCTIONAL',
        ),
      ).toThrow(UnprocessableEntityException);
    });

    it('FUNCTIONAL rejects a movement that does not converge to base currency', () => {
      expect(() =>
        assertLiquidationMovementCurrency(
          [{ currencyCode: 'USD', functionalAmountMinor: 100, functionalCurrencyCode: 'ARS' }],
          'VES',
          'FUNCTIONAL',
        ),
      ).toThrow(UnprocessableEntityException);
    });

    it('LEGACY_NOMINAL keeps the mixed currency behavior', () => {
      expect(() =>
        assertLiquidationMovementCurrency(
          [{ currencyCode: 'USD' }, { currencyCode: 'ARS' }],
          'VES',
          'LEGACY_NOMINAL',
        ),
      ).toThrow(UnprocessableEntityException);
    });
  });

  describe('publication snapshot v2', () => {
    const functionalInput = {
      ...baseInput,
      baseCurrency: 'VES',
      totalAmountMinor: 36625,
      totalsByCurrency: { USD: 1000, COP: 200 },
      valuationMode: 'FUNCTIONAL' as const,
      allocations: [
        { unitId: 'unit-1', unitCode: '1A', unitLabel: '1A', amountMinor: 36625 },
      ],
      expenses: [
        {
          expenseId: 'exp-1',
          categoryName: 'Maintenance',
          vendorName: 'Vendor',
          amountMinor: 1000,
          currencyCode: 'USD',
          invoiceDate: '2026-08-05T00:00:00.000Z',
          description: null,
          type: 'EXPENSE' as const,
          functionalAmountMinor: 36500,
          functionalCurrencyCode: 'VES',
          exchangeRateId: 'rate-1',
          exchangeRateValue: '36.5',
          exchangeRateDirection: 'DIRECT',
          exchangeRateEffectiveAt: '2026-08-04T00:00:00.000Z',
          conversionDate: '2026-08-05T00:00:00.000Z',
        },
        {
          expenseId: 'ADJ-adj-1',
          categoryName: 'Water',
          vendorName: null,
          amountMinor: 200,
          currencyCode: 'COP',
          invoiceDate: '2026-08-01T00:00:00.000Z',
          description: 'Ajuste retroactivo: correction',
          type: 'ADJUSTMENT' as const,
          sourcePeriod: '2026-08',
          functionalAmountMinor: 125,
          functionalCurrencyCode: 'VES',
          exchangeRateId: 'rate-inv',
          exchangeRateValue: '25',
          exchangeRateDirection: 'INVERSE',
          exchangeRateEffectiveAt: '2026-07-20T00:00:00.000Z',
          conversionDate: '2026-08-01T00:00:00.000Z',
        },
      ],
    };

    it('builds version 2 with functional provenance per source', () => {
      const snapshot = buildLiquidationPublicationSnapshot(functionalInput);

      expect(snapshot).toMatchObject({
        version: 2,
        valuationMode: 'FUNCTIONAL',
        totalAmountMinor: 36625,
      });
      expect(snapshot.expenses[0]).toMatchObject({
        functionalAmountMinor: 36500,
        exchangeRateValue: '36.5',
        exchangeRateDirection: 'DIRECT',
      });
      expect(snapshot.expenses[1]).toMatchObject({
        functionalAmountMinor: 125,
        exchangeRateDirection: 'INVERSE',
        exchangeRateId: 'rate-inv',
      });
    });

    it('parses version 2 back with functional provenance', () => {
      const snapshot = buildLiquidationPublicationSnapshot(functionalInput);
      const parsed = parseLiquidationPublicationSnapshot(snapshot);

      expect(parsed).toMatchObject({
        version: 2,
        valuationMode: 'FUNCTIONAL',
        totalAmountMinor: 36625,
      });
      expect(parsed?.expenses[0]).toMatchObject({
        functionalAmountMinor: 36500,
        exchangeRateValue: '36.5',
      });
    });

    it('rejects a v2 snapshot whose functional sum does not match the total', () => {
      expect(() =>
        buildLiquidationPublicationSnapshot({
          ...functionalInput,
          totalAmountMinor: 36626,
        }),
      ).toThrow(BadRequestException);
    });

    it('parses a legacy v2 snapshot as version 1 for compatibility', () => {
      const snapshot = buildLiquidationPublicationSnapshot(baseInput);
      const parsed = parseLiquidationPublicationSnapshot(snapshot);

      expect(parsed).toMatchObject({ version: 1 });
    });

    it('still parses a raw historical v1 snapshot', () => {
      const legacyV1 = {
        version: 1,
        liquidationId: 'liq-historic',
        tenantId: 'tenant-1',
        buildingId: 'building-1',
        period: '2026-04',
        baseCurrency: 'ARS',
        totalAmountMinor: 50,
        totalsByCurrency: { ARS: 50 },
        expenses: [
          {
            expenseId: 'exp-9',
            categoryName: 'Water',
            vendorName: null,
            amountMinor: 50,
            currencyCode: 'ARS',
            invoiceDate: '2026-04-01T00:00:00.000Z',
            description: null,
            type: 'EXPENSE',
          },
        ],
        allocations: [
          { unitId: 'unit-1', unitCode: '1A', unitLabel: '1A', amountMinor: 50 },
        ],
        dueDate: '2026-05-10T00:00:00.000Z',
        publishedAt: '2026-06-01T00:00:00.000Z',
      };

      const parsed = parseLiquidationPublicationSnapshot(legacyV1);
      expect(parsed).toMatchObject({ version: 1, totalAmountMinor: 50 });
    });
  });
});
