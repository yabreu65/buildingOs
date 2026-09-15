import { buildingStatsIntent } from './building-stats.intent';

describe('buildingStatsIntent currency-safe debt totals', () => {
  it('returns per-currency total and integer average buckets without a default currency', async () => {
    const prisma = {
      unit: {
        groupBy: jest.fn().mockResolvedValue([
          { unitType: 'APARTMENT', occupancyStatus: 'OCCUPIED', _count: { unitType: 3 } },
        ]),
        count: jest.fn().mockResolvedValue(2),
      },
      ticket: { count: jest.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(9) },
      charge: {
        groupBy: jest.fn().mockResolvedValue([
          { currency: 'USD', _sum: { amount: 1001 } },
          { currency: 'VES', _sum: { amount: 1000 } },
          { currency: 'UYU', _sum: { amount: 1002 } },
        ]),
      },
    };

    const result = await buildingStatsIntent.executor({
      tenantId: 'tenant-1',
      entityIds: { buildingId: 'building-1' },
      filters: {},
      prisma: prisma as never,
    });

    expect(result.data).toEqual(expect.objectContaining({
      totalUnits: 3,
      billableUnits: 2,
      openTickets: 4,
      totalTickets: 9,
      totalDebtByCurrency: [
        { currency: 'USD', amountMinor: 1001 },
        { currency: 'VES', amountMinor: 1000 },
        { currency: 'UYU', amountMinor: 1002 },
      ],
      averageDebtByCurrency: [
        { currency: 'USD', amountMinor: 334 },
        { currency: 'VES', amountMinor: 333 },
        { currency: 'UYU', amountMinor: 334 },
      ],
    }));
    expect(result.data).not.toHaveProperty('totalDebt');
    expect(result.data).not.toHaveProperty('averageDebt');
    expect(result.data).not.toHaveProperty('currency');
    expect(prisma.charge.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ['currency'],
      where: expect.objectContaining({ tenantId: 'tenant-1', buildingId: 'building-1' }),
    }));
  });
});
