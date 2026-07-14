import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LiquidationPublicationUseCase,
  type LiquidationWorkflowDependencies,
} from './liquidation-publication.use-case';

const baseLiquidation = {
  id: 'liq-1',
  tenantId: 'tenant-1',
  buildingId: 'building-1',
  period: '2026-05',
  chargePeriod: '2026-06',
  status: 'REVIEWED' as const,
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
  };
  let deps: LiquidationWorkflowDependencies;
  let useCase: LiquidationPublicationUseCase;

  beforeEach(() => {
    tx = {
      membership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'member-1',
          tenantId: 'tenant-1',
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
            version: 1,
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
});
