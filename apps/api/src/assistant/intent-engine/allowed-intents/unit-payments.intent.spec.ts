import { BadRequestException } from '@nestjs/common';
import { unitPaymentsIntent } from './unit-payments.intent';

describe('unitPaymentsIntent currency-safe payment reports', () => {
  const makePrisma = () => ({
    payment: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'p-usd', amount: 1000, currency: 'USD', method: 'TRANSFER', status: 'APPROVED', paidAt: new Date(), reference: null },
        { id: 'p-uyu', amount: 2500, currency: 'UYU', method: 'CASH', status: 'APPROVED', paidAt: new Date(), reference: null },
      ]),
    },
  });

  it('exposes payment currencies and total buckets without a tenant currency lookup', async () => {
    const prisma = makePrisma();

    const result = await unitPaymentsIntent.executor({
      tenantId: 'tenant-1',
      entityIds: { unitId: 'unit-1' },
      filters: {},
      prisma: prisma as never,
    });

    expect(result.data).toEqual(expect.objectContaining({
      payments: [
        expect.objectContaining({ amount: 1000, currency: 'USD' }),
        expect.objectContaining({ amount: 2500, currency: 'UYU' }),
      ],
      totalAmountByCurrency: [
        { currency: 'USD', amountMinor: 1000 },
        { currency: 'UYU', amountMinor: 2500 },
      ],
      total: 2,
    }));
    expect(result.data).not.toHaveProperty('totalAmount');
    expect(result.data).not.toHaveProperty('currency');
    expect(prisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ currency: true }),
    }));
  });

  it('requires currency before amount filtering or amount sorting and applies an explicit currency exactly', async () => {
    const prisma = makePrisma();
    const base = {
      tenantId: 'tenant-1',
      entityIds: { unitId: 'unit-1' },
      prisma: prisma as never,
    };

    await expect(unitPaymentsIntent.executor({ ...base, filters: { minAmount: 100 } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(unitPaymentsIntent.executor({ ...base, filters: { sortField: 'amount' } })).rejects.toBeInstanceOf(BadRequestException);

    await unitPaymentsIntent.executor({
      ...base,
      filters: { currency: 'UYU', minAmount: 100, maxAmount: 500, sortField: 'amount', sortOrder: 'desc' },
    });

    expect(prisma.payment.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: 'tenant-1',
        unitId: 'unit-1',
        currency: 'UYU',
        amount: { gte: 100, lte: 500 },
      }),
      orderBy: { amount: 'desc' },
    }));
  });
});
