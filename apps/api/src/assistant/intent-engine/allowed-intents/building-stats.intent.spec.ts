import { buildingStatsIntent } from './building-stats.intent';

interface OutstandingGroup {
  readonly currency: string;
  readonly outstanding: bigint;
}

interface PrismaMock {
  readonly unit: {
    readonly groupBy: jest.Mock;
    readonly count: jest.Mock;
  };
  readonly ticket: { readonly count: jest.Mock };
  readonly charge: { readonly findMany: jest.Mock };
  readonly $queryRaw: jest.Mock;
}

describe('buildingStatsIntent currency-safe debt totals', () => {
  it('rejects outstanding minor units over Number.MAX_SAFE_INTEGER instead of rounding', async () => {
    const prisma: PrismaMock = {
      unit: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      ticket: { count: jest.fn().mockResolvedValue(0) },
      charge: { findMany: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([
        { currency: 'USD', outstanding: BigInt(Number.MAX_SAFE_INTEGER) + 1n },
      ]),
    };

    await expect(buildingStatsIntent.executor({
      tenantId: 'tenant-1',
      entityIds: { buildingId: 'building-1' },
      filters: {},
      pagination: { limit: 10 },
      prisma: prisma as never,
    })).rejects.toThrow('safe integer');
  });
  function basePrisma(outstandingGroups: OutstandingGroup[]): PrismaMock {
    return {
      unit: {
        groupBy: jest.fn().mockResolvedValue([
          { unitType: 'APARTMENT', occupancyStatus: 'OCCUPIED', _count: { unitType: 3 } },
        ]),
        count: jest.fn().mockResolvedValue(2),
      },
      ticket: { count: jest.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(9) },
      charge: { findMany: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue(outstandingGroups),
    };
  }

  function queryText(prisma: PrismaMock): string {
    return Array.from(prisma.$queryRaw.mock.calls[0]![0] as TemplateStringsArray).join('');
  }

  it('returns per-currency outstanding buckets without a default currency', async () => {
    const prisma = basePrisma([
      { currency: 'USD', outstanding: 1001n },
      { currency: 'VES', outstanding: 1000n },
      { currency: 'UYU', outstanding: 1002n },
    ]);

    const result = await buildingStatsIntent.executor({
      tenantId: 'tenant-1',
      entityIds: { buildingId: 'building-1' },
      filters: {},
      pagination: { limit: 10 },
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
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.charge.findMany).not.toHaveBeenCalled();
  });

  it('uses grouped final outstanding totals and constrains the PostgreSQL aggregation to effective payments', async () => {
    const prisma = basePrisma([
      { currency: 'USD', outstanding: 6000n },
      { currency: 'COP', outstanding: 9000n },
    ]);

    const result = await buildingStatsIntent.executor({
      tenantId: 'tenant-1',
      entityIds: { buildingId: 'building-1' },
      filters: {},
      pagination: { limit: 10 },
      prisma: prisma as never,
    });

    expect(result.data).toEqual(expect.objectContaining({
      totalDebtByCurrency: [
        { currency: 'USD', amountMinor: 6000 },
        { currency: 'COP', amountMinor: 9000 },
      ],
      averageDebtByCurrency: [
        { currency: 'USD', amountMinor: 2000 },
        { currency: 'COP', amountMinor: 3000 },
      ],
    }));

    const query = queryText(prisma);
    expect(query).toContain('WITH charge_balances AS');
    expect(query).toContain('GREATEST(');
    expect(query).toContain("payment.status IN ('APPROVED', 'RECONCILED')");
    expect(query).toContain('payment."canceledAt" IS NULL');
    expect(query).toContain('charge."canceledAt" IS NULL');
    expect(query).toContain("charge.status IN ('PENDING', 'PARTIAL')");
    expect(query).toContain('GROUP BY charge.id, charge.currency, charge.amount');
    expect(query).toContain('WHERE outstanding > 0');
    expect(query).toContain('GROUP BY currency');
    expect(query).toContain('SELECT currency, SUM(outstanding) AS outstanding');
    expect(prisma.$queryRaw.mock.calls[0]!.slice(1)).toEqual([
      'tenant-1',
      'tenant-1',
      'tenant-1',
      'building-1',
    ]);
    expect(prisma.charge.findMany).not.toHaveBeenCalled();
  });
});
