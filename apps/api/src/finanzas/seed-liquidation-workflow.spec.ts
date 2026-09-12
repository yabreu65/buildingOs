import { Prisma } from '@prisma/client';
import { ensureSeedPublishedLiquidation } from '../../prisma/lib/seed-liquidation-workflow';

describe('ensureSeedPublishedLiquidation', () => {
  const expenseSnapshot = [{
    expenseId: 'expense-1',
    categoryName: 'Common expenses',
    vendorName: null,
    amountMinor: 200,
    currencyCode: 'ARS',
    invoiceDate: '2026-05-01T00:00:00.000Z',
    description: null,
    type: 'EXPENSE',
    scopeType: 'BUILDING',
    unitGroupId: null,
  }];

  const publishedExpenseSnapshot = [{
    expenseId: 'expense-1',
    categoryName: 'Common expenses',
    vendorName: null,
    amountMinor: 200,
    currencyCode: 'ARS',
    invoiceDate: '2026-05-01T00:00:00.000Z',
    description: null,
    type: 'EXPENSE',
  }];

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
    expenseSnapshot,
    publicationSnapshot: {
      version: 1,
      liquidationId: 'liq-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      period: '2026-05',
      baseCurrency: 'ARS',
      totalAmountMinor: 200,
      totalsByCurrency: { ARS: 200 },
      expenses: publishedExpenseSnapshot,
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
    distributionSnapshot: null,
  };

  const units = [
    { id: 'unit-1', code: '1A', label: '1A', coefficient: 1, m2: 40 },
    { id: 'unit-2', code: '1B', label: '1B', coefficient: 1, m2: 60 },
  ];

  const createPrismaMock = () => {
    let active: typeof baseLiquidation | null = baseLiquidation;
    const liquidationCreate = jest.fn().mockResolvedValue({
      ...baseLiquidation,
      id: 'liq-created',
      status: 'DRAFT',
      publicationSnapshot: null,
      reviewedAt: null,
      publishedAt: null,
    });
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
      unit: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      unitGroupMember: {
        findMany: jest.fn().mockResolvedValue([]),
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
            create: liquidationCreate,
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
      __liquidationCreate: liquidationCreate,
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
      expenseSnapshot,
      units,
      dueDate: new Date('2026-06-10T00:00:00.000Z'),
      notificationPolicy: 'disabled',
    });

    expect(result).toEqual({ id: 'liq-1', created: false, status: 'PUBLISHED' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.unit.findMany).not.toHaveBeenCalled();
    expect(prisma.unitGroupMember.findMany).not.toHaveBeenCalled();
  });

  it('reuses a published group-only liquidation using its allocation identities', async () => {
    const prisma = createPrismaMock();
    const groupExpenseSnapshot = [{
      ...expenseSnapshot[0],
      scopeType: 'UNIT_GROUP' as const,
      unitGroupId: 'group-1',
    }];
    prisma.__setActive({
      ...baseLiquidation,
      expenseSnapshot: groupExpenseSnapshot,
      publicationSnapshot: {
        ...baseLiquidation.publicationSnapshot,
        allocations: [
          { unitId: 'unit-2', unitCode: '1B', unitLabel: '1B', amountMinor: 200 },
        ],
      },
    });
    prisma.unitGroupMember.findMany.mockResolvedValue([
      {
        unit: {
          id: 'unit-2',
          code: '1B',
          label: '1B',
          m2: 60,
          unitCategory: { coefficient: 1 },
        },
      },
    ]);
    prisma.charge.findMany.mockResolvedValue([
      {
        id: 'charge-2',
        unitId: 'unit-2',
        amount: 200,
        currency: 'ARS',
        concept: 'Expensas comunes 2026-05',
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
        period: '2026-05',
        buildingId: 'building-1',
        liquidationId: 'liq-1',
      },
    ]);

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
      expenseSnapshot: groupExpenseSnapshot,
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
        expenseSnapshot,
        units,
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
      }),
    ).rejects.toThrow('does not match expected invariants');
  });

  const captureDraftDistributionSnapshot = async (
    prisma: ReturnType<typeof createPrismaMock>,
    draftUnits: typeof units,
    draftExpenseSnapshot = expenseSnapshot,
  ) => {
    prisma.__setActive(null);
    prisma.__liquidationCreate.mockRejectedValueOnce(new Error('halt after draft capture'));

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
        expenseSnapshot: draftExpenseSnapshot,
        units: draftUnits,
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
        notificationPolicy: 'disabled',
      }),
    ).rejects.toThrow('halt after draft capture');

    return prisma.__liquidationCreate.mock.calls[0][0].data.distributionSnapshot;
  };

  it('passes the canonical distribution snapshot when creating a new draft', async () => {
    const prisma = createPrismaMock();
    const distributionSnapshot = await captureDraftDistributionSnapshot(prisma, [
      { ...units[0], coefficient: 1, m2: 40 },
      { ...units[1], coefficient: 3, m2: 60 },
    ]);

    expect(distributionSnapshot).toEqual({
      version: 1,
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      totalAmountMinor: 200,
      movements: [
        {
          movementId: 'expense-1',
          scope: 'BUILDING',
          unitGroupId: null,
          amountMinor: 200,
          weightSource: 'COEFFICIENT',
          totalWeight: '4',
          recipientUnitIds: ['unit-1', 'unit-2'],
          recipients: [
            {
              unitId: 'unit-1',
              unitCode: '1A',
              unitLabel: '1A',
              coefficient: '1',
              m2: '40',
              weight: '1',
            },
            {
              unitId: 'unit-2',
              unitCode: '1B',
              unitLabel: '1B',
              coefficient: '3',
              m2: '60',
              weight: '3',
            },
          ],
          allocations: [
            { unitId: 'unit-1', unitCode: '1A', unitLabel: '1A', amountMinor: 50 },
            { unitId: 'unit-2', unitCode: '1B', unitLabel: '1B', amountMinor: 150 },
          ],
        },
      ],
      allocations: [
        { unitId: 'unit-1', unitCode: '1A', unitLabel: '1A', amountMinor: 50 },
        { unitId: 'unit-2', unitCode: '1B', unitLabel: '1B', amountMinor: 150 },
      ],
    });
  });

  it('keeps the captured draft allocation frozen after coefficient and m2 changes', async () => {
    const prisma = createPrismaMock();
    const draftUnits = [
      { ...units[0], coefficient: 1, m2: 40 },
      { ...units[1], coefficient: 3, m2: 60 },
    ];
    const distributionSnapshot = await captureDraftDistributionSnapshot(prisma, draftUnits);

    expect(distributionSnapshot.allocations).toEqual([
      { unitId: 'unit-1', unitCode: '1A', unitLabel: '1A', amountMinor: 50 },
      { unitId: 'unit-2', unitCode: '1B', unitLabel: '1B', amountMinor: 150 },
    ]);

    draftUnits[0].coefficient = 9;
    draftUnits[0].m2 = 400;
    draftUnits[1].coefficient = 1;
    draftUnits[1].m2 = 10;

    expect(distributionSnapshot.allocations).toEqual([
      { unitId: 'unit-1', unitCode: '1A', unitLabel: '1A', amountMinor: 50 },
      { unitId: 'unit-2', unitCode: '1B', unitLabel: '1B', amountMinor: 150 },
    ]);
    expect(distributionSnapshot.movements[0].recipients).toEqual([
      expect.objectContaining({ unitId: 'unit-1', coefficient: '1', m2: '40' }),
      expect.objectContaining({ unitId: 'unit-2', coefficient: '3', m2: '60' }),
    ]);
  });

  it('keeps UNIT_GROUP scope and queried group recipients in the frozen snapshot', async () => {
    const prisma = createPrismaMock();
    prisma.unitGroupMember.findMany.mockResolvedValue([
      {
        unit: {
          id: 'unit-2',
          code: '1B',
          label: '1B',
          m2: 60,
          unitCategory: { coefficient: 3 },
        },
      },
    ]);
    const groupExpenseSnapshot = [{
      ...expenseSnapshot[0],
      expenseId: 'expense-group-1',
      scopeType: 'UNIT_GROUP' as const,
      unitGroupId: 'group-1',
    }];

    const distributionSnapshot = await captureDraftDistributionSnapshot(
      prisma,
      units,
      groupExpenseSnapshot,
    );

    expect(prisma.unitGroupMember.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        buildingId: 'building-1',
        unitGroupId: 'group-1',
        unit: { isBillable: true },
      },
      include: { unit: { include: { unitCategory: { select: { coefficient: true } } } } },
    });
    expect(distributionSnapshot.movements).toEqual([
      expect.objectContaining({
        movementId: 'expense-group-1',
        scope: 'UNIT_GROUP',
        unitGroupId: 'group-1',
        recipientUnitIds: ['unit-2'],
        recipients: [
          expect.objectContaining({
            unitId: 'unit-2',
            coefficient: '3',
            m2: '60',
          }),
        ],
        allocations: [
          { unitId: 'unit-2', unitCode: '1B', unitLabel: '1B', amountMinor: 200 },
        ],
      }),
    ]);
    expect(distributionSnapshot.allocations).toEqual([
      { unitId: 'unit-2', unitCode: '1B', unitLabel: '1B', amountMinor: 200 },
    ]);
    expect(prisma.__liquidationCreate.mock.calls[0][0].data.expenseSnapshot).toEqual([
      expect.objectContaining({
        expenseId: 'expense-group-1',
        recipientUnitIds: ['unit-2'],
      }),
    ]);
  });

  it('fails closed when a unit group has no billable members', async () => {
    const prisma = createPrismaMock();
    prisma.__setActive(null);
    const groupExpenseSnapshot = [{
      ...expenseSnapshot[0],
      scopeType: 'UNIT_GROUP' as const,
      unitGroupId: 'group-1',
    }];

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
        expenseSnapshot: groupExpenseSnapshot,
        units,
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
      }),
    ).rejects.toThrow('has no billable members');
    expect(prisma.unitGroupMember.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        buildingId: 'building-1',
        unitGroupId: 'group-1',
        unit: { isBillable: true },
      },
      include: { unit: { include: { unitCategory: { select: { coefficient: true } } } } },
    });
  });

  it('publishes a reviewed liquidation from its frozen distribution after source inputs change', async () => {
    const prisma = createPrismaMock();
    const frozenDistributionSnapshot = await captureDraftDistributionSnapshot(prisma, [
      { ...units[0], coefficient: 1, m2: 40 },
      { ...units[1], coefficient: 3, m2: 60 },
    ]);
    const reviewedLiquidation = {
      ...baseLiquidation,
      status: 'REVIEWED' as const,
      publicationSnapshot: null,
      distributionSnapshot: frozenDistributionSnapshot,
      publishedAt: null,
    };
    const publishedLiquidation = {
      ...reviewedLiquidation,
      status: 'PUBLISHED' as const,
      publicationSnapshot: {
        ...baseLiquidation.publicationSnapshot,
        allocations: [
          { unitId: 'unit-1', unitCode: '1A', unitLabel: '1A', amountMinor: 50 },
          { unitId: 'unit-2', unitCode: '1B', unitLabel: '1B', amountMinor: 150 },
        ],
      },
      publishedAt: new Date('2026-05-03T00:00:00.000Z'),
    };
    const publicationCharges = [
      {
        id: 'charge-1',
        unitId: 'unit-1',
        amount: 50,
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
        amount: 150,
        currency: 'ARS',
        concept: 'Expensas comunes 2026-05',
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
        period: '2026-05',
        buildingId: 'building-1',
        liquidationId: 'liq-1',
      },
    ];
    const publicationTransaction = {
      membership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'member-1',
          tenantId: 'tenant-1',
          userId: 'user-1',
          roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }],
        }),
      },
      liquidation: {
        findFirst: jest.fn()
          .mockResolvedValueOnce(reviewedLiquidation)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(publishedLiquidation),
        updateMany: jest.fn().mockImplementation(async () => {
          prisma.__setActive(publishedLiquidation);
          return { count: 1 };
        }),
      },
      liquidationIncomeOffset: { count: jest.fn().mockResolvedValue(0) },
      unit: {
        findMany: jest.fn().mockResolvedValue([{ id: 'unit-1' }, { id: 'unit-2' }]),
      },
      charge: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    prisma.__setActive(reviewedLiquidation);
    prisma.charge.findMany.mockResolvedValue(publicationCharges);
    prisma.$transaction.mockImplementation(async (callback) => callback(publicationTransaction as never));

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
      expenseSnapshot,
      units: [
        { ...units[0], coefficient: 9, m2: 400 },
        { ...units[1], coefficient: 1, m2: 10 },
      ],
      dueDate: new Date('2026-06-10T00:00:00.000Z'),
      notificationPolicy: 'disabled',
    });

    expect(result).toEqual({ id: 'liq-1', created: false, status: 'PUBLISHED' });
    expect(publicationTransaction.unit.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        buildingId: 'building-1',
        id: { in: ['unit-1', 'unit-2'] },
      },
      select: { id: true },
    });
    expect(publicationTransaction.charge.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ unitId: 'unit-1', amount: 50 }),
        expect.objectContaining({ unitId: 'unit-2', amount: 150 }),
      ]),
    });
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
      expenseSnapshot,
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
        expenseSnapshot,
        units,
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
      }),
    ).rejects.toThrow('db down');
  });
});
