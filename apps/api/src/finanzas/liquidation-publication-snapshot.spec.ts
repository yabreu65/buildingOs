import { BadRequestException } from '@nestjs/common';
import {
  buildLiquidationPublicationSnapshot,
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
});
