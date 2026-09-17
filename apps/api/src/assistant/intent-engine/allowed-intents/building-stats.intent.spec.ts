import { PaymentStatus } from '@prisma/client';
import { buildingStatsIntent } from './building-stats.intent';

describe('buildingStatsIntent currency-safe debt totals', () => {
  function basePrisma(charges: unknown[]) {
    return {
      unit: {
        groupBy: jest.fn().mockResolvedValue([
          { unitType: 'APARTMENT', occupancyStatus: 'OCCUPIED', _count: { unitType: 3 } },
        ]),
        count: jest.fn().mockResolvedValue(2),
      },
      ticket: { count: jest.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(9) },
      charge: {
        findMany: jest.fn().mockResolvedValue(charges),
      },
    };
  }

  it('returns per-currency outstanding buckets without a default currency', async () => {
    const prisma = basePrisma([
      { amount: 1001, currency: 'USD', paymentAllocations: [] },
      { amount: 1000, currency: 'VES', paymentAllocations: [] },
      { amount: 1002, currency: 'UYU', paymentAllocations: [] },
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
    expect(prisma.charge.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'tenant-1',
        buildingId: 'building-1',
        canceledAt: null,
        status: { not: 'CANCELED' },
      }),
    }));
  });

  it('uses canonical outstanding for totalDebtByCurrency and averageDebtByCurrency', async () => {
    const prisma = basePrisma([
      {
        amount: 10000,
        currency: 'USD',
        paymentAllocations: [
          { amount: 4000, payment: { status: PaymentStatus.APPROVED, canceledAt: null } },
          { amount: 2000, payment: { status: PaymentStatus.SUBMITTED, canceledAt: null } },
        ],
      },
      {
        amount: 7000,
        currency: 'USD',
        paymentAllocations: [
          { amount: 7000, payment: { status: PaymentStatus.RECONCILED, canceledAt: null } },
        ],
      },
      {
        amount: 9000,
        currency: 'COP',
        paymentAllocations: [
          { amount: 1000, payment: { status: PaymentStatus.REJECTED, canceledAt: null } },
          { amount: 3000, payment: { status: PaymentStatus.APPROVED, canceledAt: new Date('2026-01-01') } },
        ],
      },
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
  });
});
