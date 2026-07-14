import { Prisma } from '@prisma/client';
import { ensureSeedPublishedLiquidation } from '../../prisma/lib/seed-liquidation-workflow';

describe('ensureSeedPublishedLiquidation', () => {
  const baseLiquidation = {
    id: 'liq-1',
    tenantId: 'tenant-1',
    buildingId: 'building-1',
    period: '2026-05',
    chargePeriod: '2026-06',
    status: 'PUBLISHED' as const,
    baseCurrency: 'ARS',
    totalAmountMinor: 200,
    totalsByCurrency: { ARS: 200 },
    expenseSnapshot: [],
    publicationSnapshot: {
      version: 1,
      liquidationId: 'liq-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      period: '2026-05',
      baseCurrency: 'ARS',
      totalAmountMinor: 200,
      totalsByCurrency: { ARS: 200 },
      expenses: [],
      allocations: [
        { unitId: 'unit-1', unitCode: '1A', unitLabel: '1A', amountMinor: 100 },
        { unitId: 'unit-2', unitCode: '1B', unitLabel: '1B', amountMinor: 100 },
      ],
      dueDate: '2026-06-10T00:00:00.000Z',
      publishedAt: '2026-05-03T00:00:00.000Z',
    },
    unitCount: 2,
    generatedByMembershipId: 'member-1',
    generatedAt: new Date('2026-05-01T00:00:00.000Z'),
    reviewedAt: new Date('2026-05-02T00:00:00.000Z'),
    publishedAt: new Date('2026-05-03T00:00:00.000Z'),
    canceledAt: null,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
  };

  const units = [
    { id: 'unit-1', code: '1A', label: '1A' },
    { id: 'unit-2', code: '1B', label: '1B' },
  ];

  const createPrismaMock = () => {
    let active = baseLiquidation;
    return {
      membership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'member-1',
          tenantId: 'tenant-1',
          roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }],
        }),
      },
      liquidation: {
        findFirst: jest.fn(async () => active),
      },
      charge: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'charge-1',
            unitId: 'unit-1',
            amount: 100,
            currency: 'ARS',
            concept: 'Expensas comunes 2026-05',
            dueDate: new Date('2026-06-10T00:00:00.000Z'),
            period: '2026-05',
            buildingId: 'building-1',
            liquidationId: 'liq-1',
          },
          {
            id: 'charge-2',
            unitId: 'unit-2',
            amount: 100,
            currency: 'ARS',
            concept: 'Expensas comunes 2026-05',
            dueDate: new Date('2026-06-10T00:00:00.000Z'),
            period: '2026-05',
            buildingId: 'building-1',
            liquidationId: 'liq-1',
          },
        ]),
      },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
      $transaction: jest.fn(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        callback({
          membership: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'member-1',
              tenantId: 'tenant-1',
              roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }],
            }),
          },
          liquidation: {
            create: jest.fn().mockResolvedValue({
              ...baseLiquidation,
              id: 'liq-created',
              status: 'DRAFT',
              publicationSnapshot: null,
              reviewedAt: null,
              publishedAt: null,
            }),
            findFirst: jest.fn().mockResolvedValue({
              ...baseLiquidation,
              id: 'liq-created',
              status: 'DRAFT',
              publicationSnapshot: null,
              reviewedAt: null,
              publishedAt: null,
            }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          auditLog: { create: jest.fn().mockResolvedValue(undefined) },
        } as unknown as Prisma.TransactionClient),
      ),
      __setActive: (next: typeof active) => {
        active = next;
      },
    };
  };

  it('reuses a compatible published liquidation without duplicating it', async () => {
    const prisma = createPrismaMock();

    const result = await ensureSeedPublishedLiquidation({
      prisma: prisma as never,
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      membershipId: 'member-1',
      period: '2026-05',
      chargePeriod: '2026-06',
      baseCurrency: 'ARS',
      totalAmountMinor: 200,
      totalsByCurrency: { ARS: 200 },
      expenseSnapshot: [],
      units,
      dueDate: new Date('2026-06-10T00:00:00.000Z'),
      notificationPolicy: 'disabled',
    });

    expect(result).toEqual({ id: 'liq-1', created: false, status: 'PUBLISHED' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails when an active liquidation is incompatible', async () => {
    const prisma = createPrismaMock();
    prisma.__setActive({
      ...baseLiquidation,
      totalAmountMinor: 999,
    });

    await expect(
      ensureSeedPublishedLiquidation({
        prisma: prisma as never,
        tenantId: 'tenant-1',
        buildingId: 'building-1',
        membershipId: 'member-1',
        period: '2026-05',
        chargePeriod: '2026-06',
        baseCurrency: 'ARS',
        totalAmountMinor: 200,
        totalsByCurrency: { ARS: 200 },
        expenseSnapshot: [],
        units,
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
      }),
    ).rejects.toThrow('does not match expected invariants');
  });

  it('requeries after P2002 and safely reuses the created liquidation', async () => {
    const prisma = createPrismaMock();
    prisma.liquidation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValue(baseLiquidation);
    const p2002 = new Error('unique');
    Object.assign(p2002, { code: 'P2002' });
    Object.setPrototypeOf(p2002, Prisma.PrismaClientKnownRequestError.prototype);
    prisma.$transaction.mockRejectedValueOnce(p2002);

    const result = await ensureSeedPublishedLiquidation({
      prisma: prisma as never,
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      membershipId: 'member-1',
      period: '2026-05',
      chargePeriod: '2026-06',
      baseCurrency: 'ARS',
      totalAmountMinor: 200,
      totalsByCurrency: { ARS: 200 },
      expenseSnapshot: [],
      units,
      dueDate: new Date('2026-06-10T00:00:00.000Z'),
    });

    expect(result.created).toBe(false);
    expect(result.status).toBe('PUBLISHED');
  });

  it('propagates non-P2002 prisma errors', async () => {
    const prisma = createPrismaMock();
    prisma.liquidation.findFirst.mockResolvedValueOnce(null);
    prisma.$transaction.mockRejectedValueOnce(new Error('db down'));

    await expect(
      ensureSeedPublishedLiquidation({
        prisma: prisma as never,
        tenantId: 'tenant-1',
        buildingId: 'building-1',
        membershipId: 'member-1',
        period: '2026-05',
        chargePeriod: '2026-06',
        baseCurrency: 'ARS',
        totalAmountMinor: 200,
        totalsByCurrency: { ARS: 200 },
        expenseSnapshot: [],
        units,
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
      }),
    ).rejects.toThrow('db down');
  });
});
