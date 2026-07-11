import { Test, TestingModule } from '@nestjs/testing';
import {
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
  status: 'REVIEWED',
  baseCurrency: 'ARS',
  totalAmountMinor: 101,
  totalsByCurrency: { ARS: 101 },
  expenseSnapshot: [],
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
  let auditService: { createLog: jest.Mock };
  let validators: { isAdminOrOperator: jest.Mock };
  let notificationsService: { createNotification: jest.Mock };
  let tx: {
    liquidation: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
    };
    charge: {
      count: jest.Mock;
      createMany: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    paymentAllocation: { count: jest.Mock };
    auditLog: { create: jest.Mock };
  };

  beforeEach(async () => {
    tx = {
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
            charge: {
              findMany: jest.fn().mockResolvedValue([]),
              deleteMany: jest.fn(),
            },
            paymentAllocation: { count: jest.fn().mockResolvedValue(0) },
            liquidation: {
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
          useValue: (auditService = { createLog: jest.fn() }),
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

  it('creates one charge per billable unit when publishing', async () => {
    tx.liquidation.findFirst
      .mockResolvedValueOnce({ ...baseLiquidation, status: 'REVIEWED' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...baseLiquidation,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-05-02T00:00:00.000Z'),
      });

    await service.publishLiquidation('tenant-1', 'liq-1', 'member-1', ['TENANT_ADMIN'], {
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
        where: { id: 'liq-1', tenantId: 'tenant-1' },
        data: expect.objectContaining({ status: 'PUBLISHED' }),
      }),
    );
  });

  it('returns an already published liquidation without creating duplicate charges', async () => {
    prisma.liquidation.findFirst.mockResolvedValue({
      ...baseLiquidation,
      status: 'PUBLISHED',
      publishedAt: new Date('2026-05-02T00:00:00.000Z'),
    });

    const result = await service.publishLiquidation('tenant-1', 'liq-1', 'member-1', ['TENANT_ADMIN'], {
      dueDate: '2026-06-10',
    });

    expect(result.status).toBe('PUBLISHED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('finishes publication without creating charges when all charges already exist', async () => {
    tx.charge.count.mockResolvedValueOnce(2);
    tx.liquidation.findFirst
      .mockResolvedValueOnce({ ...baseLiquidation, status: 'REVIEWED' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...baseLiquidation,
        status: 'PUBLISHED',
        publishedAt: new Date('2026-05-02T00:00:00.000Z'),
      });

    await service.publishLiquidation('tenant-1', 'liq-1', 'member-1', ['TENANT_ADMIN'], {
      dueDate: '2026-06-10',
    });

    expect(tx.charge.createMany).not.toHaveBeenCalled();
    expect(tx.liquidation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'liq-1', tenantId: 'tenant-1' },
        data: expect.objectContaining({ status: 'PUBLISHED' }),
      }),
    );
  });

  it('rejects publish when only some charges already exist', async () => {
    tx.charge.count.mockResolvedValueOnce(1);

    await expect(
      service.publishLiquidation('tenant-1', 'liq-1', 'member-1', ['TENANT_ADMIN'], {
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
      service.publishLiquidation('tenant-1', 'liq-1', 'member-1', ['TENANT_ADMIN'], {
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

    const result = await service.publishLiquidation('tenant-1', 'liq-1', 'member-1', ['TENANT_ADMIN'], {
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
      ['TENANT_ADMIN'],
      { reason: 'Board decision' },
    );

    expect(result.status).toBe('CANCELED');
    expect(tx.charge.updateMany).not.toHaveBeenCalled();
    expect(tx.liquidation.delete).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        actorMembershipId: 'member-1',
        action: 'LIQUIDATION_CANCEL',
        entity: 'Liquidation',
        entityId: 'liq-1',
        metadata: expect.objectContaining({
          period: '2026-05',
          buildingId: 'building-1',
          previousStatus: status,
          reason: 'Board decision',
        }),
      }),
    });
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
        ['TENANT_ADMIN'],
        { reason: 'Board decision' },
      ),
    ).rejects.toThrow(ConflictException);

    expect(tx.liquidation.updateMany).not.toHaveBeenCalled();
    expect(tx.charge.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
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

    await service.cancelLiquidation('tenant-1', 'liq-1', 'member-1', ['TENANT_ADMIN']);

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          reason: 'No reason provided',
        }),
      }),
    });
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
      service.cancelLiquidation('tenant-1', 'liq-1', 'member-1', ['TENANT_ADMIN'], {
        buildingId: 'building-2',
      }),
    ).rejects.toThrow(NotFoundException);

    expect(tx.charge.updateMany).not.toHaveBeenCalled();
    expect(tx.liquidation.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects cancellation for resident roles', async () => {
    validators.isAdminOrOperator.mockReturnValue(false);

    await expect(
      service.cancelLiquidation('tenant-1', 'liq-1', 'member-1', ['RESIDENT']),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.liquidation.findFirst).not.toHaveBeenCalled();
  });

  it('returns not found for another tenant', async () => {
    prisma.liquidation.findFirst.mockResolvedValue(null);

    await expect(
      service.cancelLiquidation('tenant-2', 'liq-1', 'member-1', ['TENANT_ADMIN']),
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
      ['TENANT_ADMIN'],
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

    await service.cancelLiquidation('tenant-1', 'liq-1', 'member-1', ['TENANT_ADMIN']);

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

    await service.publishLiquidation('tenant-1', 'liq-1', 'member-1', ['TENANT_ADMIN'], {
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
      service.publishLiquidation('tenant-1', 'liq-1', 'member-1', ['TENANT_ADMIN'], {
        dueDate: '2026-06-10',
      }),
    ).rejects.toThrow(ConflictException);
    expect(notifications).toHaveBeenCalledTimes(2);
    expect(auditService.createLog).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      actorMembershipId: 'member-1',
      action: 'LIQUIDATION_PUBLISH',
      entityType: 'Liquidation',
      entityId: 'liq-1',
      metadata: expect.objectContaining({
        notificationFailure: true,
        sentCount: 1,
        failedCount: 1,
      }),
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

    await service.cancelLiquidation('tenant-1', 'liq-1', 'member-1', ['TENANT_ADMIN']);
    const secondResult = await service.cancelLiquidation('tenant-1', 'liq-1', 'member-1', ['TENANT_ADMIN']);

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
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
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

    const result = await service.cancelLiquidation('tenant-1', 'liq-1', 'member-1', ['TENANT_ADMIN']);

    expect(result.status).toBe('CANCELED');
    expect(tx.liquidation.updateMany).toHaveBeenCalledWith({
      where: { id: 'liq-1', tenantId: 'tenant-1', canceledAt: null, status: { not: 'CANCELED' } },
      data: {
        status: 'CANCELED',
        canceledAt: expect.any(Date),
        canceledByMembershipId: 'member-1',
      },
    });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
