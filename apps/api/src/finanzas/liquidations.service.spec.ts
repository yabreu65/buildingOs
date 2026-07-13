import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LiquidationsService } from './liquidations.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { NotificationsService } from '../notifications/notifications.service';

const baseLiquidation = {
  id: 'liq-1',
  tenantId: 'tenant-1',
  buildingId: 'building-1',
  period: '2026-05',
  chargePeriod: '2026-06',
  status: 'REVIEWED',
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
  reviewedAt: null,
  publishedAt: null,
  canceledAt: null,
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
};

describe('LiquidationsService', () => {
  let service: LiquidationsService;
  let prisma: PrismaService;
  let auditService: { createLog: jest.Mock; createLogRequired: jest.Mock };
  let validators: { isAdminOrOperator: jest.Mock };
  let notificationsService: { createNotification: jest.Mock };
  let tx: {
    membership: {
      findFirst: jest.Mock;
    };
    building: {
      findFirst: jest.Mock;
    };
    expense: {
      count: jest.Mock;
      findMany: jest.Mock;
    };
    adjustment: {
      findMany: jest.Mock;
    };
    unit: {
      findMany: jest.Mock;
    };
    liquidation: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
    };
    charge: {
      count: jest.Mock;
      findMany: jest.Mock;
      createMany: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    paymentAllocation: { count: jest.Mock };
    auditLog: { create: jest.Mock };
  };

  beforeEach(async () => {
    tx = {
      membership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'member-1',
          tenantId: 'tenant-1',
          roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }],
        }),
      },
      building: {
        findFirst: jest.fn().mockResolvedValue({ id: 'building-1' }),
      },
      expense: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      adjustment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      unit: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'unit-1', code: '1A', label: '1A', unitCategory: null },
          { id: 'unit-2', code: '1B', label: '1B', unitCategory: null },
        ]),
      },
      liquidation: {
        findFirst: jest.fn().mockImplementation(({ where }: { where?: { status?: string } }) => {
          if (where?.status === 'PUBLISHED') {
            return Promise.resolve(null);
          }

          return Promise.resolve(baseLiquidation);
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        delete: jest.fn(),
      },
      charge: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        deleteMany: jest.fn(),
      },
      paymentAllocation: { count: jest.fn().mockResolvedValue(0) },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
    };
    validators = { isAdminOrOperator: jest.fn().mockReturnValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiquidationsService,
        {
          provide: PrismaService,
          useValue: {
            membership: {
              findFirst: jest.fn().mockResolvedValue({
                id: 'member-1',
                tenantId: 'tenant-1',
                roles: [{ role: 'TENANT_ADMIN', scopeType: 'TENANT' }],
              }),
            },
            unit: {
              findMany: jest.fn().mockResolvedValue([
                { id: 'unit-1', code: '1A', label: '1A', unitCategory: null },
                { id: 'unit-2', code: '1B', label: '1B', unitCategory: null },
              ]),
              findFirst: jest.fn().mockResolvedValue({
                id: 'unit-1',
                label: '1A',
                unitOccupants: [],
              }),
            },
            expense: {
              count: jest.fn().mockResolvedValue(0),
              findMany: jest.fn().mockResolvedValue([]),
            },
            adjustment: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            building: {
              findFirst: jest.fn().mockResolvedValue({ id: 'building-1' }),
            },
          charge: {
            findMany: jest.fn().mockResolvedValue([]),
            deleteMany: jest.fn(),
          },
            paymentAllocation: { count: jest.fn().mockResolvedValue(0) },
            liquidation: {
              findMany: jest.fn().mockResolvedValue([baseLiquidation]),
              findFirst: jest.fn().mockImplementation(({ where }: { where?: { status?: string; id?: { not?: string } } }) => {
                if (where?.status === 'PUBLISHED' && where?.id?.not === 'liq-1') {
                  return Promise.resolve(null);
                }

                return Promise.resolve(baseLiquidation);
              }),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              delete: jest.fn(),
              findUniqueOrThrow: jest.fn().mockResolvedValue({
                ...baseLiquidation,
                status: 'PUBLISHED',
                publishedAt: new Date('2026-05-02T00:00:00.000Z'),
              }),
            },
            $transaction: jest.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
          },
        },
        {
          provide: AuditService,
          useValue: (auditService = {
            createLog: jest.fn(),
            createLogRequired: jest.fn().mockResolvedValue(undefined),
          }),
        },
        {
          provide: FinanzasValidators,
          useValue: validators,
        },
        {
          provide: NotificationsService,
          useValue: (notificationsService = { createNotification: jest.fn() }),
        },
      ],
    }).compile();

    service = module.get<LiquidationsService>(LiquidationsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('includes chargePeriod when mapping a liquidation response', async () => {
    const liquidations = await service.listLiquidations(
      'tenant-1',
      'member-1',
      {},
    );

    expect(liquidations).toEqual([
      expect.objectContaining({ chargePeriod: '2026-06' }),
    ]);
  });

  it('creates one charge per billable unit when publishing', async () => {
    tx.liquidation.findFirst
      .mockResolvedValueOnce({ ...baseLiquidation, status: 'REVIEWED' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...baseLiquidation,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-05-02T00:00:00.000Z'),
      });

    await service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
      dueDate: '2026-06-10',
    });

    expect(tx.charge.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ unitId: 'unit-1', amount: 51, liquidationId: 'liq-1' }),
        expect.objectContaining({ unitId: 'unit-2', amount: 50, liquidationId: 'liq-1' }),
      ]),
    });
    expect(tx.liquidation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'liq-1',
          tenantId: 'tenant-1',
          status: 'REVIEWED',
          publicationSnapshot: { equals: Prisma.DbNull },
        },
        data: expect.objectContaining({ status: 'PUBLISHED' }),
      }),
    );
  });

  it('returns an already published liquidation without creating duplicate charges', async () => {
    tx.liquidation.findFirst.mockResolvedValueOnce({
      ...baseLiquidation,
      status: 'PUBLISHED',
      publishedAt: new Date('2026-05-02T00:00:00.000Z'),
    });

    const result = await service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
      dueDate: '2026-06-10',
    });

    expect(result.status).toBe('PUBLISHED');
    expect(tx.charge.createMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('rejects draft creation when the base currency is missing from totalsByCurrency', async () => {
    tx.liquidation.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    tx.expense.count.mockResolvedValueOnce(0);
    tx.expense.findMany
      .mockResolvedValueOnce([
        {
          id: 'exp-1',
          amountMinor: 100,
          currencyCode: 'ARS',
          invoiceDate: new Date('2026-05-01T00:00:00.000Z'),
          description: null,
          category: { name: 'Water' },
          vendor: { name: 'Vendor' },
          allocations: [],
        },
      ])
      .mockResolvedValueOnce([]);
    tx.adjustment.findMany.mockResolvedValueOnce([]);
    tx.unit.findMany.mockResolvedValueOnce([
      { id: 'unit-1', code: '1A', label: '1A', unitCategory: null },
    ]);

    await expect(
      service.createDraft('tenant-1', 'member-1', {
        buildingId: 'building-1',
        period: '2026-05',
        baseCurrency: 'USD',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(auditService.createLogRequired).not.toHaveBeenCalled();
  });

  it('finishes publication without creating charges when all charges already exist', async () => {
    tx.charge.findMany.mockResolvedValueOnce([
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
    tx.liquidation.findFirst
      .mockResolvedValueOnce({ ...baseLiquidation, status: 'REVIEWED' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...baseLiquidation,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-05-02T00:00:00.000Z'),
      });

    await service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
      dueDate: '2026-06-10',
    });

    expect(tx.charge.createMany).not.toHaveBeenCalled();
    expect(tx.charge.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-1',
          liquidationId: 'liq-1',
          buildingId: 'building-1',
          period: '2026-05',
        },
      }),
    );
    expect(tx.liquidation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'liq-1',
          tenantId: 'tenant-1',
          status: 'REVIEWED',
          publicationSnapshot: { equals: Prisma.DbNull },
        },
        data: expect.objectContaining({ status: 'PUBLISHED' }),
      }),
    );
  });

  it('rejects publish when only some charges already exist', async () => {
    tx.charge.findMany.mockResolvedValueOnce([
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
    ]);

    await expect(
      service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
        dueDate: '2026-06-10',
      }),
    ).rejects.toThrow(ConflictException);
    expect(tx.charge.createMany).not.toHaveBeenCalled();
  });

  it('rejects publish when existing charges do not match the publication snapshot', async () => {
    tx.charge.findMany.mockResolvedValueOnce([
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
      service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
        dueDate: '2026-06-10',
      }),
    ).rejects.toThrow(ConflictException);
    expect(tx.charge.createMany).not.toHaveBeenCalled();
  });

  it('rejects a concurrent publication of another liquidation for the same period inside the transaction', async () => {
    const publishedOtherLiquidation = {
      ...baseLiquidation,
      id: 'liq-2',
      status: 'PUBLISHED',
      publishedAt: new Date('2026-05-02T00:00:00.000Z'),
    };

    tx.liquidation.findFirst
      .mockResolvedValueOnce(baseLiquidation)
      .mockResolvedValueOnce({ status: 'REVIEWED' })
      .mockResolvedValueOnce(publishedOtherLiquidation);

    await expect(
      service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
        dueDate: '2026-06-10',
      }),
    ).rejects.toThrow(ConflictException);

    expect(tx.charge.createMany).not.toHaveBeenCalled();
    expect(tx.liquidation.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
  });

  it('returns the current published liquidation when publication completes concurrently', async () => {
    const publishedLiquidation = {
      ...baseLiquidation,
      status: 'PUBLISHED',
      publishedAt: new Date('2026-05-02T00:00:00.000Z'),
    };

    tx.liquidation.findFirst
      .mockResolvedValueOnce({ ...baseLiquidation, status: 'PUBLISHED' })
      .mockResolvedValueOnce(publishedLiquidation);

    const result = await service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
      dueDate: '2026-06-10',
    });

    expect(result.status).toBe('PUBLISHED');
    expect(tx.charge.createMany).not.toHaveBeenCalled();
    expect(tx.liquidation.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
  });

  it('returns the published liquidation after a serializable conflict when the row is already published', async () => {
    const serializationError = new Error('Transaction conflict');
    Object.assign(serializationError, { code: 'P2034' });
    Object.setPrototypeOf(serializationError, Prisma.PrismaClientKnownRequestError.prototype);

    const publishedLiquidation = {
      ...baseLiquidation,
      status: 'PUBLISHED',
      publishedAt: new Date('2026-05-02T00:00:00.000Z'),
    };

    prisma.$transaction.mockRejectedValueOnce(serializationError);
    prisma.liquidation.findFirst.mockResolvedValueOnce(publishedLiquidation);

    const result = await service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
      dueDate: '2026-06-10',
    });

    expect(result.status).toBe('PUBLISHED');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.charge.createMany).not.toHaveBeenCalled();
  });

  it.each([
    ['DRAFT', 'draft'],
    ['REVIEWED', 'approved'],
  ])('cancels a %s liquidation transactionally without hard deleting it', async (status) => {
    const liquidation = {
      ...baseLiquidation,
      status,
      reviewedAt: status === 'REVIEWED' ? new Date('2026-05-02T00:00:00.000Z') : null,
    };

    prisma.liquidation.findFirst.mockResolvedValue(liquidation);
    tx.liquidation.findFirst
      .mockResolvedValueOnce(liquidation)
      .mockResolvedValueOnce({
        ...liquidation,
        status: 'CANCELED',
        canceledAt: new Date('2026-05-03T00:00:00.000Z'),
        canceledByMembershipId: 'member-1',
      });
    tx.liquidation.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.cancelLiquidation(
      'tenant-1',
      'liq-1',
      'member-1',
      { reason: 'Board decision' },
    );

    expect(result.status).toBe('CANCELED');
    expect(tx.charge.updateMany).not.toHaveBeenCalled();
    expect(tx.liquidation.delete).not.toHaveBeenCalled();
    expect(auditService.createLogRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorMembershipId: 'member-1',
        action: 'LIQUIDATION_CANCEL',
        entityType: 'Liquidation',
        entityId: 'liq-1',
        metadata: expect.objectContaining({
          period: '2026-05',
          buildingId: 'building-1',
          previousStatus: status,
          reason: 'Board decision',
        }),
      }),
      tx,
    );
  });

  it('rejects cancellation of a published liquidation', async () => {
    const publishedLiquidation = {
      ...baseLiquidation,
      status: 'PUBLISHED',
      publishedAt: new Date('2026-05-02T00:00:00.000Z'),
    };
    prisma.liquidation.findFirst.mockResolvedValue(publishedLiquidation);
    tx.liquidation.findFirst.mockResolvedValue(publishedLiquidation);

    await expect(
      service.cancelLiquidation(
        'tenant-1',
        'liq-1',
        'member-1',
        { reason: 'Board decision' },
      ),
    ).rejects.toThrow(ConflictException);

    expect(tx.liquidation.updateMany).not.toHaveBeenCalled();
    expect(tx.charge.updateMany).not.toHaveBeenCalled();
    expect(auditService.createLogRequired).not.toHaveBeenCalled();
  });

  it('uses a fallback reason when none is provided', async () => {
    const draftLiquidation = {
      ...baseLiquidation,
      status: 'DRAFT',
    };
    prisma.liquidation.findFirst.mockResolvedValue(draftLiquidation);
    tx.liquidation.findFirst
      .mockResolvedValueOnce(draftLiquidation)
      .mockResolvedValueOnce({
        ...draftLiquidation,
        status: 'CANCELED',
        canceledAt: new Date('2026-05-03T00:00:00.000Z'),
        canceledByMembershipId: 'member-1',
      });
    tx.liquidation.updateMany.mockResolvedValue({ count: 1 });

    await service.cancelLiquidation('tenant-1', 'liq-1', 'member-1');

    expect(auditService.createLogRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          reason: 'No reason provided',
        }),
      }),
      tx,
    );
  });

  it('rejects cancellation when the requested buildingId does not match', async () => {
    const publishedLiquidation = {
      ...baseLiquidation,
      status: 'PUBLISHED',
      publishedAt: new Date('2026-05-02T00:00:00.000Z'),
    };
    prisma.liquidation.findFirst.mockResolvedValue(publishedLiquidation);
    tx.liquidation.findFirst.mockResolvedValue(publishedLiquidation);

    await expect(
      service.cancelLiquidation('tenant-1', 'liq-1', 'member-1', {
        buildingId: 'building-2',
      }),
    ).rejects.toThrow(NotFoundException);

    expect(tx.charge.updateMany).not.toHaveBeenCalled();
    expect(tx.liquidation.updateMany).not.toHaveBeenCalled();
    expect(auditService.createLogRequired).not.toHaveBeenCalled();
  });

  it('rejects cancellation for resident roles', async () => {
    validators.isAdminOrOperator.mockReturnValue(false);

    await expect(
      service.cancelLiquidation('tenant-1', 'liq-1', 'member-1'),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.liquidation.findFirst).not.toHaveBeenCalled();
  });

  it('returns not found for another tenant', async () => {
    prisma.liquidation.findFirst.mockResolvedValue(null);

    await expect(
      service.cancelLiquidation('tenant-2', 'liq-1', 'member-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns an already canceled liquidation without mutating it again', async () => {
    const canceledLiquidation = {
      ...baseLiquidation,
      status: 'CANCELED',
      canceledAt: new Date('2026-05-03T00:00:00.000Z'),
    };
    prisma.liquidation.findFirst.mockResolvedValue(canceledLiquidation);

    const result = await service.cancelLiquidation(
      'tenant-1',
      'liq-1',
      'member-1',
    );

    expect(result.status).toBe('CANCELED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.liquidation.updateMany).not.toHaveBeenCalled();
    expect(tx.charge.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('does not hard delete liquidation records or their charges', async () => {
    const draftLiquidation = {
      ...baseLiquidation,
      status: 'DRAFT',
    };
    prisma.liquidation.findFirst.mockResolvedValue(draftLiquidation);
    tx.liquidation.findFirst
      .mockResolvedValueOnce(draftLiquidation)
      .mockResolvedValueOnce({
        ...draftLiquidation,
        status: 'CANCELED',
        canceledAt: new Date('2026-05-03T00:00:00.000Z'),
        canceledByMembershipId: 'member-1',
      });
    tx.liquidation.updateMany.mockResolvedValue({ count: 1 });

    await service.cancelLiquidation('tenant-1', 'liq-1', 'member-1');

    expect(prisma.liquidation.delete).not.toHaveBeenCalled();
    expect(tx.liquidation.delete).not.toHaveBeenCalled();
    expect(tx.charge.deleteMany).not.toHaveBeenCalled();
    expect(tx.liquidation.updateMany).toHaveBeenCalledWith({
      where: { id: 'liq-1', tenantId: 'tenant-1', canceledAt: null, status: { not: 'CANCELED' } },
      data: {
        status: 'CANCELED',
        canceledAt: expect.any(Date),
        canceledByMembershipId: 'member-1',
      },
    });
  });

  it('scopes notification lookups by tenant when publishing', async () => {
    tx.charge.count.mockResolvedValueOnce(2);
    tx.liquidation.findFirst
      .mockResolvedValueOnce({ ...baseLiquidation, status: 'REVIEWED' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...baseLiquidation,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-05-02T00:00:00.000Z'),
      });
    prisma.charge.findMany.mockResolvedValueOnce([
      {
        id: 'charge-1',
        unitId: 'unit-1',
        amount: 100,
        currency: 'ARS',
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
      },
    ]);

    await service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
      dueDate: '2026-06-10',
    });

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(prisma.charge.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', liquidationId: 'liq-1' },
    });
    expect(prisma.unit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-1',
          buildingId: 'building-1',
          id: 'unit-1',
        },
      }),
    );
  });

  it('continues notification dispatch when one recipient fails', async () => {
    tx.charge.count.mockResolvedValueOnce(2);
    tx.liquidation.findFirst
      .mockResolvedValueOnce({ ...baseLiquidation, status: 'REVIEWED' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...baseLiquidation,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-05-02T00:00:00.000Z'),
      });
    prisma.charge.findMany.mockResolvedValueOnce([
      {
        id: 'charge-1',
        unitId: 'unit-1',
        amount: 100,
        currency: 'ARS',
        dueDate: new Date('2026-06-10T00:00:00.000Z'),
      },
    ]);
    prisma.unit.findFirst.mockResolvedValueOnce({
      id: 'unit-1',
      label: '1A',
      unitOccupants: [
        {
          member: { id: 'member-1', user: { id: 'user-1' } },
        },
        {
          member: { id: 'member-2', user: { id: 'user-2' } },
        },
      ],
    });
    const notifications = notificationsService.createNotification;
    notifications
      .mockRejectedValueOnce(new Error('notification failed'))
      .mockResolvedValueOnce(undefined);

    await expect(
      service.publishLiquidation('tenant-1', 'liq-1', 'member-1', {
        dueDate: '2026-06-10',
      }),
    ).resolves.toMatchObject({ status: 'PUBLISHED' });
    expect(notifications).toHaveBeenCalledTimes(2);
    expect(auditService.createLogRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorMembershipId: 'member-1',
        action: 'LIQUIDATION_PUBLISH',
        entityType: 'Liquidation',
        entityId: 'liq-1',
        metadata: expect.objectContaining({
          snapshotVersion: 1,
          dueDate: '2026-06-10',
        }),
      }),
      tx,
    );
    expect(prisma.unit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-1',
          buildingId: 'building-1',
          id: 'unit-1',
        },
      }),
    );
  });

  it('is idempotent when the same liquidation is canceled twice', async () => {
    const draftLiquidation = {
      ...baseLiquidation,
      status: 'DRAFT',
    };
    const canceledLiquidation = {
      ...baseLiquidation,
      status: 'CANCELED',
      canceledAt: new Date('2026-05-03T00:00:00.000Z'),
    };

    prisma.liquidation.findFirst
      .mockResolvedValueOnce(draftLiquidation)
      .mockResolvedValueOnce(canceledLiquidation);
    tx.liquidation.findFirst
      .mockResolvedValueOnce(draftLiquidation)
      .mockResolvedValueOnce({
        ...draftLiquidation,
        status: 'CANCELED',
        canceledAt: new Date('2026-05-03T00:00:00.000Z'),
        canceledByMembershipId: 'member-1',
      });
    tx.liquidation.updateMany.mockResolvedValue({ count: 1 });

    await service.cancelLiquidation('tenant-1', 'liq-1', 'member-1');
    const secondResult = await service.cancelLiquidation('tenant-1', 'liq-1', 'member-1');

    expect(secondResult.status).toBe('CANCELED');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.liquidation.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.liquidation.updateMany).toHaveBeenCalledWith({
      where: { id: 'liq-1', tenantId: 'tenant-1', canceledAt: null, status: { not: 'CANCELED' } },
      data: {
        status: 'CANCELED',
        canceledAt: expect.any(Date),
        canceledByMembershipId: 'member-1',
      },
    });
    expect(auditService.createLogRequired).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
  });

  it('treats a concurrent cancellation race as idempotent when the record is already canceled', async () => {
    const draftLiquidation = {
      ...baseLiquidation,
      status: 'DRAFT',
    };
    const canceledLiquidation = {
      ...baseLiquidation,
      status: 'CANCELED',
      canceledAt: new Date('2026-05-03T00:00:00.000Z'),
    };

    prisma.liquidation.findFirst
      .mockResolvedValueOnce(draftLiquidation)
      .mockResolvedValueOnce(canceledLiquidation);
    tx.liquidation.findFirst
      .mockResolvedValueOnce(draftLiquidation)
      .mockResolvedValueOnce(canceledLiquidation);
    tx.liquidation.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await service.cancelLiquidation('tenant-1', 'liq-1', 'member-1');

    expect(result.status).toBe('CANCELED');
    expect(tx.liquidation.updateMany).toHaveBeenCalledWith({
      where: { id: 'liq-1', tenantId: 'tenant-1', canceledAt: null, status: { not: 'CANCELED' } },
      data: {
        status: 'CANCELED',
        canceledAt: expect.any(Date),
        canceledByMembershipId: 'member-1',
      },
    });
    expect(auditService.createLogRequired).not.toHaveBeenCalled();
  });
});
