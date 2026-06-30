import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
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
  let tx: {
    liquidation: { findFirst: jest.Mock; update: jest.Mock };
    charge: { count: jest.Mock; createMany: jest.Mock };
  };

  beforeEach(async () => {
    tx = {
      liquidation: {
        findFirst: jest.fn().mockResolvedValue({ status: 'REVIEWED' }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      charge: {
        count: jest.fn().mockResolvedValue(0),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiquidationsService,
        {
          provide: PrismaService,
          useValue: {
            liquidation: {
              findFirst: jest.fn()
                .mockResolvedValueOnce(baseLiquidation)
                .mockResolvedValueOnce(null),
              findUniqueOrThrow: jest.fn().mockResolvedValue({
                ...baseLiquidation,
                status: 'PUBLISHED',
                publishedAt: new Date('2026-05-02T00:00:00.000Z'),
              }),
            },
            unit: {
              findMany: jest.fn().mockResolvedValue([
                { id: 'unit-1', code: '1A', label: '1A', unitCategory: null },
                { id: 'unit-2', code: '1B', label: '1B', unitCategory: null },
              ]),
            },
            charge: { findMany: jest.fn().mockResolvedValue([]) },
            $transaction: jest.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
          },
        },
        { provide: AuditService, useValue: { createLog: jest.fn() } },
        {
          provide: FinanzasValidators,
          useValue: { isAdminOrOperator: jest.fn().mockReturnValue(true) },
        },
        { provide: NotificationsService, useValue: { createNotification: jest.fn() } },
      ],
    }).compile();

    service = module.get<LiquidationsService>(LiquidationsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('creates one charge per billable unit when publishing', async () => {
    await service.publishLiquidation('tenant-1', 'liq-1', 'member-1', ['TENANT_ADMIN'], {
      dueDate: '2026-06-10',
    });

    expect(tx.charge.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ unitId: 'unit-1', amount: 51, liquidationId: 'liq-1' }),
        expect.objectContaining({ unitId: 'unit-2', amount: 50, liquidationId: 'liq-1' }),
      ]),
    });
    expect(tx.liquidation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'liq-1' },
        data: expect.objectContaining({ status: 'PUBLISHED' }),
      }),
    );
  });

  it('returns an already published liquidation without creating duplicate charges', async () => {
    jest.spyOn(prisma.liquidation, 'findFirst').mockReset();
    jest.spyOn(prisma.liquidation, 'findFirst').mockResolvedValue({
      ...baseLiquidation,
      status: 'PUBLISHED',
      publishedAt: new Date('2026-05-02T00:00:00.000Z'),
    } as any);

    const result = await service.publishLiquidation('tenant-1', 'liq-1', 'member-1', ['TENANT_ADMIN'], {
      dueDate: '2026-06-10',
    });

    expect(result.status).toBe('PUBLISHED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('finishes publication without creating charges when all charges already exist', async () => {
    tx.charge.count.mockResolvedValueOnce(2);

    await service.publishLiquidation('tenant-1', 'liq-1', 'member-1', ['TENANT_ADMIN'], {
      dueDate: '2026-06-10',
    });

    expect(tx.charge.createMany).not.toHaveBeenCalled();
    expect(tx.liquidation.update).toHaveBeenCalledWith(
      expect.objectContaining({
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
});
