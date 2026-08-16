import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LiquidationPublicationUseCase,
  sendChargePublishedNotifications,
  type LiquidationWorkflowDependencies,
} from './liquidation-publication.use-case';

const baseLiquidation = {
  id: 'liq-1',
  tenantId: 'tenant-1',
  buildingId: 'building-1',
  period: '2026-05',
  chargePeriod: '2026-06',
  status: 'REVIEWED' as const,
  valuationMode: null,
  baseCurrency: 'ARS',
  totalAmountMinor: 101,
  totalsByCurrency: { ARS: 101 },
  expenseSnapshot: [
    {
      expenseId: 'exp-1',
      categoryName: 'Water',
      vendorName: 'Vendor',
      amountMinor: 101,
      currencyCode: 'ARS',
      invoiceDate: '2026-05-01T00:00:00.000Z',
      description: null,
      type: 'EXPENSE',
    },
  ],
  unitCount: 2,
  generatedAt: new Date('2026-05-01T00:00:00.000Z'),
  reviewedAt: new Date('2026-05-02T00:00:00.000Z'),
  publishedAt: null,
  canceledAt: null,
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
};

describe('LiquidationPublicationUseCase', () => {
  const createKnownError = (code: 'P2002' | 'P2034', message: string) => {
    const error = new Error(message);
    Object.assign(error, { code });
    Object.setPrototypeOf(error, Prisma.PrismaClientKnownRequestError.prototype);
    return error;
  };

  let tx: {
    membership: { findFirst: jest.Mock };
    liquidation: { findFirst: jest.Mock; updateMany: jest.Mock };
    unit: { findMany: jest.Mock };
    charge: { findMany: jest.Mock; createMany: jest.Mock };
    auditLog: { create: jest.Mock };
    liquidationIncomeOffset: { findMany: jest.Mock; count: jest.Mock };
    incomeApplication: { findMany: jest.Mock };
  };
  let deps: LiquidationWorkflowDependencies;
  let useCase: LiquidationPublicationUseCase;

  beforeEach(() => {
    tx = {
      membership: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'member-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }],
      }),
      },
      liquidation: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(baseLiquidation)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            ...baseLiquidation,
            status: 'PUBLISHED',
            publishedAt: new Date('2026-05-03T00:00:00.000Z'),
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      unit: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'unit-1', code: '1A', label: '1A', unitCategory: null },
          { id: 'unit-2', code: '1B', label: '1B', unitCategory: null },
        ]),
      },
      charge: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
      liquidationIncomeOffset: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      incomeApplication: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    deps = {
      prisma: {
        $transaction: jest.fn(async (callback) =>
          callback(tx as unknown as Prisma.TransactionClient),
        ),
        membership: tx.membership,
        liquidation: {
          findFirst: jest.fn(),
          create: jest.fn(),
        },
      } as unknown as LiquidationWorkflowDependencies['prisma'],
      isAdminOrOperator: jest.fn().mockReturnValue(true),
      createAuditLogRequired: jest.fn().mockResolvedValue(undefined),
      createAuditLog: jest.fn().mockResolvedValue(undefined),
      toPublishedLiquidationDto: jest.fn((liquidation) => ({
        id: liquidation.id,
        tenantId: liquidation.tenantId,
        buildingId: liquidation.buildingId,
        period: liquidation.period,
        chargePeriod: liquidation.chargePeriod,
        status: liquidation.status,
        baseCurrency: liquidation.baseCurrency,
        totalAmountMinor: liquidation.totalAmountMinor,
        totalsByCurrency: liquidation.totalsByCurrency as Record<string, number>,
        unitCount: liquidation.unitCount,
        generatedAt: liquidation.generatedAt,
        reviewedAt: liquidation.reviewedAt,
        publishedAt: liquidation.publishedAt,
        canceledAt: liquidation.canceledAt,
        createdAt: liquidation.createdAt,
      })),
      sendChargePublishedNotifications: jest.fn().mockResolvedValue({
        sentCount: 0,
        failedCount: 0,
        errorMessages: [],
      }),
    };

    useCase = new LiquidationPublicationUseCase(deps);
  });

  it('publishes a reviewed liquidation and creates charges exactly once', async () => {
    const result = await useCase.execute('tenant-1', 'liq-1', 'member-1', {
      dueDate: '2026-06-10',
    });

    expect(result.status).toBe('PUBLISHED');
    expect(tx.charge.createMany).toHaveBeenCalledTimes(1);
    expect(deps.createAuditLogRequired).toHaveBeenCalledTimes(1);
    expect(tx.liquidation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PUBLISHED',
          publicationSnapshot: expect.objectContaining({
            version: 2,
            valuationMode: 'LEGACY_NOMINAL',
            totalAmountMinor: 101,
            dueDate: '2026-06-10T00:00:00.000Z',
          }),
        }),
      }),
    );
  });

  it('rejects publication when status is not REVIEWED', async () => {
    tx.liquidation.findFirst.mockReset().mockResolvedValue({
      ...baseLiquidation,
      status: 'DRAFT',
    });

    await expect(
      useCase.execute('tenant-1', 'liq-1', 'member-1', {
        dueDate: '2026-06-10',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('reuses compatible existing charges instead of creating duplicates', async () => {
    tx.charge.findMany.mockResolvedValue([
      {
        unitId: 'unit-1',
        amount: 51,
        currency: 'ARS',
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
        buildingId: 'building-1',
        period: '2026-05',
        liquidationId: 'liq-1',
        concept: 'Expensas comunes 2026-05',
      },
      {
        unitId: 'unit-2',
        amount: 50,
        currency: 'ARS',
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
        buildingId: 'building-1',
        period: '2026-05',
        liquidationId: 'liq-1',
        concept: 'Expensas comunes 2026-05',
      },
    ]);

    await useCase.execute('tenant-1', 'liq-1', 'member-1', {
      dueDate: '2026-06-10',
    });

    expect(tx.charge.createMany).not.toHaveBeenCalled();
  });

  it('fails when existing charges are incompatible', async () => {
    tx.charge.findMany.mockResolvedValue([
      {
        unitId: 'unit-1',
        amount: 999,
        currency: 'ARS',
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
        buildingId: 'building-1',
        period: '2026-05',
        liquidationId: 'liq-1',
        concept: 'Expensas comunes 2026-05',
      },
      {
        unitId: 'unit-2',
        amount: 50,
        currency: 'ARS',
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
        buildingId: 'building-1',
        period: '2026-05',
        liquidationId: 'liq-1',
        concept: 'Expensas comunes 2026-05',
      },
    ]);

    await expect(
      useCase.execute('tenant-1', 'liq-1', 'member-1', {
        dueDate: '2026-06-10',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('returns the published liquidation after P2002 when a concurrent publish already won', async () => {
    (deps.prisma.$transaction as jest.Mock).mockRejectedValueOnce(
      createKnownError('P2002', 'Unique violation'),
    );
    (deps.prisma.liquidation.findFirst as jest.Mock).mockResolvedValueOnce({
      ...baseLiquidation,
      status: 'PUBLISHED',
      publishedAt: new Date('2026-05-03T00:00:00.000Z'),
    });

    const result = await useCase.execute('tenant-1', 'liq-1', 'member-1', {
      dueDate: '2026-06-10',
    });

    expect(result.status).toBe('PUBLISHED');
  });

  it('returns the published liquidation after P2034 when a concurrent publish already won', async () => {
    (deps.prisma.$transaction as jest.Mock).mockRejectedValueOnce(
      createKnownError('P2034', 'Serialization conflict'),
    );
    (deps.prisma.liquidation.findFirst as jest.Mock).mockResolvedValueOnce({
      ...baseLiquidation,
      status: 'PUBLISHED',
      publishedAt: new Date('2026-05-03T00:00:00.000Z'),
    });

    const result = await useCase.execute('tenant-1', 'liq-1', 'member-1', {
      dueDate: '2026-06-10',
    });

    expect(result.status).toBe('PUBLISHED');
  });

  it('skips external notifications when policy is disabled', async () => {
    await useCase.execute(
      'tenant-1',
      'liq-1',
      'member-1',
      { dueDate: '2026-06-10' },
      'disabled',
    );

    expect(deps.sendChargePublishedNotifications).not.toHaveBeenCalled();
  });

  it('does not roll back publication when post-commit notifications report failures', async () => {
    (deps.sendChargePublishedNotifications as jest.Mock).mockResolvedValueOnce({
      sentCount: 0,
      failedCount: 1,
      errorMessages: ['mail failed'],
    });

    const result = await useCase.execute('tenant-1', 'liq-1', 'member-1', {
      dueDate: '2026-06-10',
    });

    expect(result.status).toBe('PUBLISHED');
    expect(deps.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          notificationFailure: true,
          errors: ['mail failed'],
        }),
      }),
    );
  });

  it('excludes the publishing actor from charge-published notifications', async () => {
    const notificationsService = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = {
      charge: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'charge-1',
            unitId: 'unit-1',
            dueDate: new Date('2026-05-10T00:00:00.000Z'),
            amount: 101,
            currency: 'ARS',
          },
        ]),
      },
      unit: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'unit-1',
          label: '1A',
          unitOccupants: [
            { member: { user: { id: 'user-1' } } },
            { member: { user: { id: 'resident-2' } } },
          ],
        }),
      },
    } as never;

    await sendChargePublishedNotifications(
      prisma,
      notificationsService,
      'tenant-1',
      'liq-1',
      {
        period: '2026-05',
        buildingId: 'building-1',
        baseCurrency: 'ARS',
      },
      'user-1',
    );

    expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
    expect(notificationsService.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'resident-2',
      type: 'CHARGE_PUBLISHED',
    }));
    expect(notificationsService.createNotification).not.toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
    }));
  });

  describe('FUNCTIONAL valuation publication', () => {
    const functionalLiquidation = {
      ...baseLiquidation,
      valuationMode: 'FUNCTIONAL' as const,
      baseCurrency: 'VES',
      totalAmountMinor: 36625,
      totalsByCurrency: { USD: 1000, COP: 200 },
      expenseSnapshot: [
        {
          expenseId: 'exp-1',
          categoryName: 'Maintenance',
          vendorName: 'Vendor',
          amountMinor: 1000,
          currencyCode: 'USD',
          invoiceDate: '2026-08-05T00:00:00.000Z',
          description: null,
          type: 'EXPENSE',
          functionalAmountMinor: 36500,
          functionalCurrencyCode: 'VES',
          exchangeRateId: 'rate-1',
          exchangeRateValue: '36.5',
          exchangeRateDirection: 'DIRECT',
          exchangeRateEffectiveAt: '2026-08-04T00:00:00.000Z',
          conversionDate: '2026-08-05T00:00:00.000Z',
        },
        {
          expenseId: 'ADJ-adj-1',
          categoryName: 'Water',
          vendorName: null,
          amountMinor: 200,
          currencyCode: 'COP',
          invoiceDate: '2026-08-01T00:00:00.000Z',
          description: 'Ajuste retroactivo: correction',
          type: 'ADJUSTMENT',
          sourcePeriod: '2026-08',
          functionalAmountMinor: 125,
          functionalCurrencyCode: 'VES',
          exchangeRateId: 'rate-inv',
          exchangeRateValue: '25',
          exchangeRateDirection: 'INVERSE',
          exchangeRateEffectiveAt: '2026-07-20T00:00:00.000Z',
          conversionDate: '2026-08-01T00:00:00.000Z',
        },
      ],
    };

    const mockFunctionalPublish = () => {
      tx.liquidation.findFirst
        .mockReset()
        .mockResolvedValueOnce(functionalLiquidation)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...functionalLiquidation,
          status: 'PUBLISHED',
          publishedAt: new Date('2026-08-10T00:00:00.000Z'),
        })
        .mockResolvedValueOnce({
          ...functionalLiquidation,
          status: 'PUBLISHED',
          publishedAt: new Date('2026-08-10T00:00:00.000Z'),
        });
      tx.unit.findMany.mockResolvedValue([
        { id: 'unit-1', code: '1A', label: '1A', unitCategory: null },
      ]);
      tx.charge.findMany.mockResolvedValue([]);
    };

    it('publishes a FUNCTIONAL liquidation and writes a version 2 snapshot', async () => {
      mockFunctionalPublish();

      const result = await useCase.execute(
        'tenant-1',
        'liq-1',
        'member-1',
        { dueDate: '2026-09-10' },
        'post-commit',
      );

      expect(result.status).toBe('PUBLISHED');
      const snapshotUpdate = (tx.liquidation.updateMany as jest.Mock).mock.calls.find(
        (call) => (call[0].data?.publicationSnapshot as { version?: number })?.version === 2,
      );
      expect(snapshotUpdate).toBeDefined();
      expect(snapshotUpdate[0].data.publicationSnapshot).toMatchObject({
        version: 2,
        valuationMode: 'FUNCTIONAL',
        totalAmountMinor: 36625,
      });
      expect(snapshotUpdate[0].data.publicationSnapshot.expenses[1]).toMatchObject({
        expenseId: 'ADJ-adj-1',
        functionalAmountMinor: 125,
        exchangeRateDirection: 'INVERSE',
      });
    });

    it('charges equal the functional total exactly', async () => {
      mockFunctionalPublish();

      await useCase.execute(
        'tenant-1',
        'liq-1',
        'member-1',
        { dueDate: '2026-09-10' },
        'post-commit',
      );

      const chargeCreate = (tx.charge.createMany as jest.Mock).mock.calls[0] as [
        { data: Array<{ amount: number; currency: string }> },
      ];
      const totalCharges = chargeCreate[0].data.reduce(
        (sum, charge) => sum + charge.amount,
        0,
      );
      expect(totalCharges).toBe(36625);
      expect(chargeCreate[0].data.every((charge) => charge.currency === 'VES')).toBe(true);
    });

    it('blocks publication when the source snapshot drifts from the total', async () => {
      mockFunctionalPublish();
      tx.liquidation.findFirst
        .mockReset()
        .mockResolvedValueOnce({
          ...functionalLiquidation,
          totalAmountMinor: 36626,
        })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...functionalLiquidation,
          status: 'PUBLISHED',
          publishedAt: new Date('2026-08-10T00:00:00.000Z'),
        })
        .mockResolvedValueOnce({
          ...functionalLiquidation,
          status: 'PUBLISHED',
          publishedAt: new Date('2026-08-10T00:00:00.000Z'),
        });

      await expect(
        useCase.execute(
          'tenant-1',
          'liq-1',
          'member-1',
          { dueDate: '2026-09-10' },
          'post-commit',
        ),
      ).rejects.toMatchObject({
        response: {
          statusCode: 422,
          error: 'LIQUIDATION_PUBLICATION_SOURCE_DRIFT',
        },
      });
      expect(tx.charge.createMany).not.toHaveBeenCalled();
    });
  });

  describe('FIN-06 income offset publication', () => {
    const incomeOffsetLiquidation = {
      ...baseLiquidation,
      period: '2026-08',
      totalAmountMinor: 3000,
      totalsByCurrency: { ARS: 10000 },
      expenseSnapshot: [
        {
          expenseId: 'exp-1',
          categoryName: 'Water',
          vendorName: null,
          amountMinor: 10000,
          currencyCode: 'ARS',
          invoiceDate: '2026-08-05T00:00:00.000Z',
          description: null,
          type: 'EXPENSE',
        },
      ],
      grossExpenseAmountMinor: 10000,
      adjustmentAmountMinor: 0,
      preIncomeAmountMinor: 10000,
      incomeOffsetAmountMinor: 7000,
      netDistributableAmountMinor: 3000,
      incomeOffsetSnapshot: [
        {
          incomeId: 'income-1',
          incomeApplicationId: 'app-offset-1',
          categoryId: 'cat-1',
          categoryName: 'Parrillera',
          policyVersionId: 'pv-1',
          scopeType: 'BUILDING',
          currencyCode: 'ARS',
          applicationAmountMinor: 7000,
          buildingAmountMinor: 7000,
          valuedAmountMinor: 7000,
          functionalCurrencyCode: null,
          exchangeRateId: null,
          exchangeRateValue: null,
          exchangeRateDirection: null,
          exchangeRateEffectiveAt: null,
          conversionDate: null,
          receivedDate: '2026-08-10T00:00:00.000Z',
          period: '2026-08',
        },
      ],
      incomeOffsetsByCurrency: { ARS: 7000 },
    };

    const validReference = {
      incomeApplicationId: 'app-offset-1',
      buildingId: 'building-1',
      originalAmountMinor: 7000,
      currencyCode: 'ARS',
      valuedAmountMinor: 7000,
      baseCurrency: 'ARS',
    };

    const validApplication = {
      id: 'app-offset-1',
      incomeId: 'income-1',
      destinationType: 'OFFSET_EXPENSES',
      amountMinor: 7000,
      currencyCode: 'ARS',
      policyVersionId: 'pv-1',
      income: {
        id: 'income-1',
        status: 'RECORDED',
        period: '2026-08',
      },
    };

    it('publishes an income-offset liquidation with a version 3 snapshot and no zero charges', async () => {
      tx.liquidation.findFirst.mockReset();
      tx.liquidationIncomeOffset.findMany.mockReset();
      tx.incomeApplication.findMany.mockReset();
      tx.liquidation.findFirst
        .mockResolvedValueOnce(incomeOffsetLiquidation)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...incomeOffsetLiquidation,
          status: 'PUBLISHED',
          publishedAt: new Date('2026-08-16T00:00:00.000Z'),
        });
      tx.liquidationIncomeOffset.count.mockResolvedValueOnce(1);
      tx.liquidationIncomeOffset.findMany.mockResolvedValueOnce([validReference]);
      tx.incomeApplication.findMany.mockResolvedValueOnce([validApplication]);

      const result = await useCase.execute('tenant-1', 'liq-1', 'member-1', {
        dueDate: '2026-09-10',
      });

      expect(result.status).toBe('PUBLISHED');
      expect(deps.createAuditLogRequired).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            snapshotVersion: 3,
            incomeOffsetAmountMinor: 7000,
            incomeOffsetCount: 1,
          }),
        }),
        tx,
      );
      const publishedSnapshot = tx.liquidation.updateMany.mock.calls[0]![0]!.data
        .publicationSnapshot as Record<string, unknown>;
      expect(publishedSnapshot.version).toBe(3);
      expect(publishedSnapshot.incomeOffsetAmountMinor).toBe(7000);
      expect(publishedSnapshot.netDistributableAmountMinor).toBe(3000);
      expect(tx.charge.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ amount: 1500, unitId: 'unit-1', liquidationId: 'liq-1' }),
        ]),
      });
    });

    it('publishes a zero-net liquidation without creating positive charges', async () => {
      const zeroNetLiquidation = {
        ...incomeOffsetLiquidation,
        totalAmountMinor: 0,
        incomeOffsetAmountMinor: 10000,
        netDistributableAmountMinor: 0,
        incomeOffsetSnapshot: [
          {
            ...incomeOffsetLiquidation.incomeOffsetSnapshot[0],
            valuedAmountMinor: 10000,
            buildingAmountMinor: 10000,
            applicationAmountMinor: 10000,
          },
        ],
        incomeOffsetsByCurrency: { ARS: 10000 },
      };

      tx.liquidation.findFirst.mockReset();
      tx.liquidationIncomeOffset.findMany.mockReset();
      tx.incomeApplication.findMany.mockReset();
      tx.liquidation.findFirst
        .mockResolvedValueOnce(zeroNetLiquidation)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...zeroNetLiquidation,
          status: 'PUBLISHED',
          publishedAt: new Date('2026-08-16T00:00:00.000Z'),
        });
      tx.liquidationIncomeOffset.count.mockResolvedValueOnce(1);
      tx.liquidationIncomeOffset.findMany.mockResolvedValueOnce([
        {
          ...validReference,
          originalAmountMinor: 10000,
          valuedAmountMinor: 10000,
        },
      ]);
      tx.incomeApplication.findMany.mockResolvedValueOnce([
        { ...validApplication, amountMinor: 10000 },
      ]);

      const result = await useCase.execute('tenant-1', 'liq-1', 'member-1', {
        dueDate: '2026-09-10',
      });

      expect(result.status).toBe('PUBLISHED');
      expect(tx.charge.createMany).not.toHaveBeenCalled();
      // FIN-06R: zero-net audit debe reportar chargesCount = 0 (sin cargos reales)
      // y allocationCount = 2 (unidades del building).
      expect(deps.createAuditLogRequired).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            chargesCount: 0,
            allocationCount: 2,
            snapshotVersion: 3,
          }),
        }),
        tx,
      );
    });

    it('rejects publication when the offset source drifted from the draft snapshot', async () => {
      tx.liquidation.findFirst.mockReset();
      tx.liquidationIncomeOffset.findMany.mockReset();
      tx.incomeApplication.findMany.mockReset();
      tx.liquidation.findFirst
        .mockResolvedValueOnce(incomeOffsetLiquidation)
        .mockResolvedValueOnce(null);
      tx.liquidationIncomeOffset.count.mockResolvedValueOnce(1);
      tx.liquidationIncomeOffset.findMany.mockResolvedValueOnce([validReference]);
      tx.incomeApplication.findMany.mockResolvedValueOnce([
        { ...validApplication, destinationType: 'FUND' },
      ]);

      await expect(
        useCase.execute('tenant-1', 'liq-1', 'member-1', { dueDate: '2026-09-10' }),
      ).rejects.toMatchObject({
        response: {
          statusCode: 422,
          error: 'LIQUIDATION_INCOME_SOURCE_DRIFT',
        },
      });
      expect(tx.charge.createMany).not.toHaveBeenCalled();
    });

    it('rejects publication when the income is no longer RECORDED', async () => {
      tx.liquidation.findFirst.mockReset();
      tx.liquidationIncomeOffset.findMany.mockReset();
      tx.incomeApplication.findMany.mockReset();
      tx.liquidation.findFirst
        .mockResolvedValueOnce(incomeOffsetLiquidation)
        .mockResolvedValueOnce(null);
      tx.liquidationIncomeOffset.count.mockResolvedValueOnce(1);
      tx.liquidationIncomeOffset.findMany.mockResolvedValueOnce([validReference]);
      tx.incomeApplication.findMany.mockResolvedValueOnce([
        { ...validApplication, income: { id: 'income-1', status: 'VOID', period: '2026-08' } },
      ]);

      await expect(
        useCase.execute('tenant-1', 'liq-1', 'member-1', { dueDate: '2026-09-10' }),
      ).rejects.toMatchObject({
        response: {
          statusCode: 422,
          error: 'LIQUIDATION_INCOME_SOURCE_DRIFT',
        },
      });
    });

    it('rejects publication when the expense sources do not match pre-income', async () => {
      tx.liquidation.findFirst.mockReset();
      tx.liquidationIncomeOffset.findMany.mockReset();
      tx.incomeApplication.findMany.mockReset();
      const drifted = {
        ...incomeOffsetLiquidation,
        expenseSnapshot: [
          {
            expenseId: 'exp-1',
            categoryName: 'Water',
            vendorName: null,
            amountMinor: 9999,
            currencyCode: 'ARS',
            invoiceDate: '2026-08-05T00:00:00.000Z',
            description: null,
            type: 'EXPENSE',
          },
        ],
      };

      tx.liquidation.findFirst.mockResolvedValueOnce(drifted).mockResolvedValueOnce(null);
      tx.liquidationIncomeOffset.count.mockResolvedValueOnce(1);
      tx.liquidationIncomeOffset.findMany.mockResolvedValueOnce([validReference]);
      tx.incomeApplication.findMany.mockResolvedValueOnce([validApplication]);

      await expect(
        useCase.execute('tenant-1', 'liq-1', 'member-1', { dueDate: '2026-09-10' }),
      ).rejects.toMatchObject({
        response: {
          statusCode: 422,
          error: 'LIQUIDATION_PUBLICATION_SOURCE_DRIFT',
        },
      });
    });
  });
});
