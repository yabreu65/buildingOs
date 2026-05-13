import { buildingPaymentsIntent } from './building-payments.intent';

describe('buildingPaymentsIntent', () => {
  it('queries tenant-wide payments when buildingId is not provided', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const groupBy = jest.fn().mockResolvedValue([]);
    const prisma = {
      payment: {
        findMany,
        groupBy,
      },
    } as any;

    const result = await buildingPaymentsIntent.executor({
      tenantId: 'tenant-1',
      entityIds: {},
      filters: { method: 'TRANSFER', period: '2026-04' },
      pagination: { limit: 20 },
      prisma,
    });

    expect(result).toEqual({
      data: {
        payments: [],
        sumByMethod: {},
        totalAmount: 0,
        total: 0,
      },
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          method: 'TRANSFER',
        }),
      }),
    );
    const where = findMany.mock.calls[0][0].where;
    expect(where.buildingId).toBeUndefined();
  });
});

