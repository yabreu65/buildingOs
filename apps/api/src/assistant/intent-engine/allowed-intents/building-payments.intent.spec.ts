import { BadRequestException } from '@nestjs/common';
import { buildingPaymentsIntent } from './building-payments.intent';

describe('buildingPaymentsIntent currency-safe payment reports', () => {
  it('queries tenant-wide payments and returns currency buckets per total and method', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'p-usd', amount: 1000, currency: 'USD', method: 'TRANSFER', status: 'APPROVED', paidAt: new Date(), unitId: null, reference: null },
      { id: 'p-uyu', amount: 2500, currency: 'UYU', method: 'TRANSFER', status: 'APPROVED', paidAt: new Date(), unitId: 'unit-1', reference: null },
    ]);
    const groupBy = jest.fn().mockResolvedValue([
      { method: 'TRANSFER', currency: 'USD', _sum: { amount: 1000 } },
      { method: 'TRANSFER', currency: 'UYU', _sum: { amount: 2500 } },
    ]);
    const prisma = { payment: { findMany, groupBy } };

    const result = await buildingPaymentsIntent.executor({
      tenantId: 'tenant-1',
      entityIds: {},
      filters: { method: 'TRANSFER', period: '2026-04' },
      pagination: { limit: 20 },
      prisma: prisma as never,
    });

    expect(result.data).toEqual({
      payments: [
        expect.objectContaining({ amount: 1000, currency: 'USD' }),
        expect.objectContaining({ amount: 2500, currency: 'UYU' }),
      ],
      sumByMethod: {
        TRANSFER: [
          { currency: 'USD', amountMinor: 1000 },
          { currency: 'UYU', amountMinor: 2500 },
        ],
      },
      totalAmountByCurrency: [
        { currency: 'USD', amountMinor: 1000 },
        { currency: 'UYU', amountMinor: 2500 },
      ],
      total: 2,
    });
    expect(result.data).not.toHaveProperty('totalAmount');
    expect(result.data).not.toHaveProperty('currency');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 'tenant-1', method: 'TRANSFER' }),
      select: expect.objectContaining({ currency: true }),
    }));
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ['method', 'currency'] }));
    const where = findMany.mock.calls[0][0].where;
    expect(where.buildingId).toBeUndefined();
  });

  it('requires currency before amount filtering or amount sorting and applies USD exactly', async () => {
    const prisma = { payment: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) } };
    const base = { tenantId: 'tenant-1', entityIds: { buildingId: 'building-1' }, prisma: prisma as never };

    await expect(buildingPaymentsIntent.executor({ ...base, filters: { maxAmount: 500 } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(buildingPaymentsIntent.executor({ ...base, filters: { sortField: 'amount' } })).rejects.toBeInstanceOf(BadRequestException);

    await buildingPaymentsIntent.executor({
      ...base,
      filters: { currency: 'USD', minAmount: 100, maxAmount: 500, sortField: 'amount' },
    });

    expect(prisma.payment.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'tenant-1',
        buildingId: 'building-1',
        currency: 'USD',
        amount: { gte: 100, lte: 500 },
      }),
      orderBy: { amount: 'asc' },
    }));
  });
});
