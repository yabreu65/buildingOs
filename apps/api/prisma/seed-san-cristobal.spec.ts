import { parseLiquidationPublicationSnapshot } from '../src/finanzas/liquidation-publication-snapshot';
import { buildSanCristobalLegacyPublicationSnapshot } from './seed-san-cristobal';

describe('San Cristóbal seed publication snapshot', () => {
  it('builds a V2 legacy snapshot from the generated charges and persisted expense sources', () => {
    const dueDate = new Date('2026-01-05T00:00:00.000Z');
    const publishedAt = new Date('2026-01-01T12:00:00.000Z');

    const publicationSnapshot = buildSanCristobalLegacyPublicationSnapshot({
      liquidationId: 'liquidation-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      period: '2025-12',
      baseCurrency: 'USD',
      totalAmountMinor: 100,
      expenses: [
        {
          expenseId: 'expense-1',
          categoryName: 'Electricity',
          vendorName: null,
          amountMinor: 100,
          currencyCode: 'USD',
          invoiceDate: '2025-12-15T00:00:00.000Z',
          description: 'Validated seed expense',
          type: 'EXPENSE',
        },
      ],
      charges: [
        { unitId: 'unit-a', unitCode: 'A-0101', unitLabel: 'A 0101', amountMinor: 40 },
        { unitId: 'unit-b', unitCode: 'A-0102', unitLabel: 'A 0102', amountMinor: 60 },
      ],
      dueDate,
      publishedAt,
    });
    const parsedSnapshot = parseLiquidationPublicationSnapshot(publicationSnapshot);

    expect(publicationSnapshot).toEqual(expect.objectContaining({
      version: 2,
      valuationMode: 'LEGACY_NOMINAL',
      totalAmountMinor: 100,
      totalsByCurrency: { USD: 100 },
      dueDate: dueDate.toISOString(),
      publishedAt: publishedAt.toISOString(),
    }));
    expect(parsedSnapshot?.expenses).toEqual([expect.objectContaining({ expenseId: 'expense-1' })]);
    expect(parsedSnapshot?.allocations).toEqual([
      { unitId: 'unit-a', unitCode: 'A-0101', unitLabel: 'A 0101', amountMinor: 40 },
      { unitId: 'unit-b', unitCode: 'A-0102', unitLabel: 'A 0102', amountMinor: 60 },
    ]);
  });
});
