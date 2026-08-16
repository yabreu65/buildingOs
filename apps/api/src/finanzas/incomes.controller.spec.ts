import { Test } from '@nestjs/testing';
import { IncomeDestination } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IncomesController } from './incomes.controller';
import { IncomesService } from './incomes.service';
import { IncomeApplicationsService } from './income-applications.service';
import { LegacyIncomeBackfillService } from './legacy-income-backfill.service';

describe('IncomesController legacy-backfill routes (FIN-04)', () => {
  let controller: IncomesController;
  let backfill: { preview: jest.Mock; apply: jest.Mock };

  beforeEach(async () => {
    backfill = { preview: jest.fn().mockResolvedValue([]), apply: jest.fn().mockResolvedValue([]) };

    const module = await Test.createTestingModule({
      controllers: [IncomesController],
      providers: [
        { provide: PrismaService, useValue: { membership: { findUnique: jest.fn() } } },
        { provide: IncomesService, useValue: { getIncome: jest.fn() } },
        { provide: IncomeApplicationsService, useValue: {} },
        { provide: LegacyIncomeBackfillService, useValue: backfill },
      ],
    }).compile();

    controller = module.get(IncomesController);
  });

  it('routes GET legacy-backfill/preview to the backfill service, not :incomeId', async () => {
    const result = await controller.previewLegacyBackfill(
      { period: '2026-08', categoryId: 'cat-1', destination: IncomeDestination.APPLY_TO_EXPENSES },
      {
        tenantId: 'tenant-1',
        user: { membershipId: 'member-1', roles: ['TENANT_ADMIN'] },
      } as never,
    );

    expect(backfill.preview).toHaveBeenCalledWith('tenant-1', 'member-1', {
      period: '2026-08',
      categoryId: 'cat-1',
      destination: IncomeDestination.APPLY_TO_EXPENSES,
    });
    expect(result).toEqual([]);
  });

  it('routes POST legacy-backfill/apply to the backfill service', async () => {
    backfill.apply.mockResolvedValue([{ incomeId: 'income-1', status: 'MIGRATED' }]);
    const result = await controller.applyLegacyBackfill(
      { items: [{ incomeId: 'income-1' }] },
      {
        tenantId: 'tenant-1',
        user: { membershipId: 'member-1', roles: ['TENANT_ADMIN'] },
      } as never,
    );

    expect(backfill.apply).toHaveBeenCalledWith('tenant-1', 'member-1', [
      { incomeId: 'income-1' },
    ]);
    expect(result).toEqual([{ incomeId: 'income-1', status: 'MIGRATED' }]);
  });

  it('passes undefined filters when not provided', async () => {
    await controller.previewLegacyBackfill(
      { period: undefined, categoryId: undefined, destination: undefined },
      {
        tenantId: 'tenant-1',
        user: { membershipId: 'member-1', roles: ['TENANT_ADMIN'] },
      } as never,
    );

    expect(backfill.preview).toHaveBeenCalledWith('tenant-1', 'member-1', {
      period: undefined,
      categoryId: undefined,
      destination: undefined,
    });
  });
});
