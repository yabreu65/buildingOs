import {
  BadRequestException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  FundStatus,
  FundType,
  IncomeApplicationDestination,
  IncomeDestination,
  IncomeStatus,
  Prisma,
} from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { IncomeApplicationsService } from './income-applications.service';
import { LegacyIncomeBackfillService, LEGACY_BACKFILL_LIQUIDATION_CONFLICT } from './legacy-income-backfill.service';

describe('LegacyIncomeBackfillService (FIN-04)', () => {
  let service: LegacyIncomeBackfillService;
  let prisma: {
    membership: { findFirst: jest.Mock };
    income: { findMany: jest.Mock; findFirst: jest.Mock };
    incomeApplication: { count: jest.Mock; findFirst: jest.Mock; groupBy: jest.Mock };
    movementAllocation: { findMany: jest.Mock };
    liquidation: { findMany: jest.Mock };
    fund: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let applicationsService: { publishLegacyBackfillPlan: jest.Mock };
  let audit: { createLogRequired: jest.Mock };
  let validators: { isAdminOrOperator: jest.Mock };

  const roles = ['TENANT_ADMIN'];
  const membershipId = 'member-1';

  function makeIncome(overrides: Record<string, unknown> = {}) {
    return {
      id: 'income-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      period: '2026-08',
      scopeType: 'BUILDING',
      status: IncomeStatus.RECORDED,
      destination: IncomeDestination.APPLY_TO_EXPENSES,
      amountMinor: 10000,
      currencyCode: 'ARS',
      receivedDate: new Date('2026-08-10T00:00:00.000Z'),
      categoryId: 'cat-1',
      ...overrides,
    };
  }

  function setupTx(overrides: Record<string, unknown> = {}) {
    const tx = {
      income: {
        findFirst: jest.fn().mockResolvedValue(makeIncome(overrides)),
        findMany: jest.fn().mockResolvedValue([]),
      },
      incomeApplication: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      movementAllocation: { findMany: jest.fn().mockResolvedValue([]) },
      liquidation: { findMany: jest.fn().mockResolvedValue([]) },
      fund: { findFirst: jest.fn().mockResolvedValue(null) },
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: (t: unknown) => unknown) =>
      callback(tx),
    );
    return tx;
  }

  beforeEach(async () => {
    prisma = {
      membership: { findFirst: jest.fn().mockResolvedValue({ id: membershipId }) },
      income: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      incomeApplication: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      movementAllocation: { findMany: jest.fn().mockResolvedValue([]) },
      liquidation: { findMany: jest.fn().mockResolvedValue([]) },
      fund: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    };
    applicationsService = { publishLegacyBackfillPlan: jest.fn() };
    audit = { createLogRequired: jest.fn().mockResolvedValue(undefined) };
    validators = { isAdminOrOperator: jest.fn().mockReturnValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LegacyIncomeBackfillService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: FinanzasValidators, useValue: validators },
        { provide: IncomeApplicationsService, useValue: applicationsService },
      ],
    }).compile();

    service = module.get(LegacyIncomeBackfillService);
  });

  // ── Classification / preview ────────────────────────────────────────────

  it('classifies APPLY_TO_EXPENSES without applications as AUTO_MAPPABLE_OFFSET', async () => {
    prisma.income.findMany.mockResolvedValue([makeIncome()]);
    const result = await service.preview('tenant-1', membershipId, roles, {});

    expect(result).toHaveLength(1);
    expect(result[0]!.classification).toBe('AUTO_MAPPABLE_OFFSET');
  });

  it('classifies RESERVE_FUND as REQUIRES_RESERVE_FUND', async () => {
    prisma.income.findMany.mockResolvedValue([
      makeIncome({ destination: IncomeDestination.RESERVE_FUND }),
    ]);
    const result = await service.preview('tenant-1', membershipId, roles, {});

    expect(result[0]!.classification).toBe('REQUIRES_RESERVE_FUND');
  });

  it('classifies SPECIAL_FUND as REQUIRES_SPECIAL_FUND', async () => {
    prisma.income.findMany.mockResolvedValue([
      makeIncome({ destination: IncomeDestination.SPECIAL_FUND }),
    ]);
    const result = await service.preview('tenant-1', membershipId, roles, {});

    expect(result[0]!.classification).toBe('REQUIRES_SPECIAL_FUND');
  });

  it('classifies income with existing applications as ALREADY_HAS_PLAN', async () => {
    prisma.income.findMany.mockResolvedValue([makeIncome()]);
    prisma.incomeApplication.groupBy.mockResolvedValue([
      { incomeId: 'income-1', _count: { _all: 1 } },
    ]);
    const result = await service.preview('tenant-1', membershipId, roles, {});

    expect(result[0]!.classification).toBe('ALREADY_HAS_PLAN');
  });

  it('classifies DRAFT/VOID as NOT_RECORDED', async () => {
    prisma.income.findMany.mockResolvedValue([
      makeIncome({ status: IncomeStatus.DRAFT }),
      makeIncome({ id: 'income-2', status: IncomeStatus.VOID }),
    ]);
    const result = await service.preview('tenant-1', membershipId, roles, {});

    expect(result.map((item) => item.classification)).toEqual(['NOT_RECORDED', 'NOT_RECORDED']);
  });

  it('classifies APPLY with relevant non-canceled liquidation as LIQUIDATION_CONFLICT', async () => {
    prisma.income.findMany.mockResolvedValue([makeIncome()]);
    prisma.liquidation.findMany.mockResolvedValue([
      { buildingId: 'building-1', status: 'DRAFT' },
    ]);
    const result = await service.preview('tenant-1', membershipId, roles, {});

    expect(result[0]!.classification).toBe('LIQUIDATION_CONFLICT');
  });

  it('preview performs zero writes', async () => {
    prisma.income.findMany.mockResolvedValue([makeIncome()]);
    await service.preview('tenant-1', membershipId, roles, {});

    expect(applicationsService.publishLegacyBackfillPlan).not.toHaveBeenCalled();
    expect(audit.createLogRequired).not.toHaveBeenCalled();
  });

  it('rejects non-admin roles', async () => {
    validators.isAdminOrOperator.mockReturnValue(false);

    await expect(service.preview('tenant-1', membershipId, ['RESIDENT'], {})).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.apply('tenant-1', membershipId, ['RESIDENT'], [])).rejects.toThrow(
      ForbiddenException,
    );
  });

  // ── Apply ───────────────────────────────────────────────────────────────

  it('APPLY materializes 100% OFFSET via shared publisher with legacy provenance', async () => {
    setupTx();
    (applicationsService.publishLegacyBackfillPlan as jest.Mock).mockResolvedValue({
      incomeId: 'income-1',
      totalAmountMinor: 10000,
      applications: [{ id: 'app-1', destinationType: 'OFFSET_EXPENSES' }],
    });

    const result = await service.apply('tenant-1', membershipId, roles, [
      { incomeId: 'income-1' },
    ]);

    expect(result).toEqual([{ incomeId: 'income-1', status: 'MIGRATED' }]);
    expect(applicationsService.publishLegacyBackfillPlan).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        legacyDestination: IncomeDestination.APPLY_TO_EXPENSES,
        plan: [
          {
            destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
            fundId: null,
            amountMinor: 10000,
          },
        ],
      }),
    );
    expect(audit.createLogRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'INCOME_LEGACY_BACKFILL',
        metadata: expect.objectContaining({ mode: 'EXPLICIT_BACKFILL' }),
      }),
      expect.anything(),
    );
  });

  it('RESERVE_FUND requires an explicit fundId (REQUIRES_FUND)', async () => {
    setupTx({ destination: IncomeDestination.RESERVE_FUND });
    const result = await service.apply('tenant-1', membershipId, roles, [
      { incomeId: 'income-1' },
    ]);

    expect(result[0]!.status).toBe('REQUIRES_FUND');
    expect(applicationsService.publishLegacyBackfillPlan).not.toHaveBeenCalled();
  });

  it('SPECIAL_FUND requires an explicit fundId (REQUIRES_FUND)', async () => {
    setupTx({ destination: IncomeDestination.SPECIAL_FUND });
    const result = await service.apply('tenant-1', membershipId, roles, [
      { incomeId: 'income-1' },
    ]);

    expect(result[0]!.status).toBe('REQUIRES_FUND');
  });

  it('RESERVE_FUND rejects a SPECIAL fund (INVALID_FUND)', async () => {
    setupTx({ destination: IncomeDestination.RESERVE_FUND });
    prisma.fund.findFirst.mockResolvedValue({
      id: 'fund-1',
      status: FundStatus.ACTIVE,
      type: FundType.SPECIAL,
    });

    const result = await service.apply('tenant-1', membershipId, roles, [
      { incomeId: 'income-1', fundId: 'fund-1' },
    ]);

    expect(result[0]!.status).toBe('INVALID_FUND');
  });

  it('SPECIAL_FUND rejects a RESERVE fund (INVALID_FUND)', async () => {
    setupTx({ destination: IncomeDestination.SPECIAL_FUND });
    prisma.fund.findFirst.mockResolvedValue({
      id: 'fund-1',
      status: FundStatus.ACTIVE,
      type: FundType.RESERVE,
    });

    const result = await service.apply('tenant-1', membershipId, roles, [
      { incomeId: 'income-1', fundId: 'fund-1' },
    ]);

    expect(result[0]!.status).toBe('INVALID_FUND');
  });

  it('rejects an archived Fund (INVALID_FUND)', async () => {
    setupTx({ destination: IncomeDestination.RESERVE_FUND });
    prisma.fund.findFirst.mockResolvedValue({
      id: 'fund-1',
      status: FundStatus.ARCHIVED,
      type: FundType.RESERVE,
    });

    const result = await service.apply('tenant-1', membershipId, roles, [
      { incomeId: 'income-1', fundId: 'fund-1' },
    ]);

    expect(result[0]!.status).toBe('INVALID_FUND');
  });

  it('rejects a cross-tenant Fund (INVALID_FUND)', async () => {
    setupTx({ destination: IncomeDestination.RESERVE_FUND });
    prisma.fund.findFirst.mockResolvedValue(null);

    const result = await service.apply('tenant-1', membershipId, roles, [
      { incomeId: 'income-1', fundId: 'fund-other-tenant' },
    ]);

    expect(result[0]!.status).toBe('INVALID_FUND');
  });

  it('RESERVE_FUND materializes with fund CREDIT occurredAt = receivedDate', async () => {
    const tx = setupTx({ destination: IncomeDestination.RESERVE_FUND });
    tx.fund.findFirst.mockResolvedValue({
      id: 'fund-1',
      status: FundStatus.ACTIVE,
      type: FundType.RESERVE,
    });
    (applicationsService.publishLegacyBackfillPlan as jest.Mock).mockResolvedValue({
      incomeId: 'income-1',
      totalAmountMinor: 10000,
      applications: [{ id: 'app-1', destinationType: 'FUND' }],
    });

    const result = await service.apply('tenant-1', membershipId, roles, [
      { incomeId: 'income-1', fundId: 'fund-1' },
    ]);

    expect(result[0]!.status).toBe('MIGRATED');
    expect(applicationsService.publishLegacyBackfillPlan).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        legacyDestination: IncomeDestination.RESERVE_FUND,
        fundTransactionOccurredAt: new Date('2026-08-10T00:00:00.000Z'),
        plan: [
          {
            destinationType: IncomeApplicationDestination.FUND,
            fundId: 'fund-1',
            amountMinor: 10000,
          },
        ],
      }),
    );
  });

  it('retry with existing legacy application is idempotent (ALREADY_MIGRATED)', async () => {
    const tx = setupTx();
    tx.incomeApplication.count.mockResolvedValue(1);
    tx.incomeApplication.findFirst.mockResolvedValue({ id: 'app-1' });

    const result = await service.apply('tenant-1', membershipId, roles, [
      { incomeId: 'income-1' },
    ]);

    expect(result[0]!.status).toBe('ALREADY_MIGRATED');
    expect(applicationsService.publishLegacyBackfillPlan).not.toHaveBeenCalled();
  });

  it('retry with existing non-legacy plan is ALREADY_HAS_PLAN', async () => {
    const tx = setupTx();
    tx.incomeApplication.count.mockResolvedValue(1);
    tx.incomeApplication.findFirst.mockResolvedValue(null);

    const result = await service.apply('tenant-1', membershipId, roles, [
      { incomeId: 'income-1' },
    ]);

    expect(result[0]!.status).toBe('ALREADY_HAS_PLAN');
  });

  it('DRAFT income apply returns NOT_RECORDED', async () => {
    setupTx({ status: IncomeStatus.DRAFT });
    const result = await service.apply('tenant-1', membershipId, roles, [
      { incomeId: 'income-1' },
    ]);

    expect(result[0]!.status).toBe('NOT_RECORDED');
  });

  it('VOID income apply returns NOT_RECORDED (never revived)', async () => {
    setupTx({ status: IncomeStatus.VOID });
    const result = await service.apply('tenant-1', membershipId, roles, [
      { incomeId: 'income-1' },
    ]);

    expect(result[0]!.status).toBe('NOT_RECORDED');
    expect(applicationsService.publishLegacyBackfillPlan).not.toHaveBeenCalled();
  });

  it('unknown income returns NOT_FOUND', async () => {
    const tx = setupTx();
    tx.income.findFirst.mockResolvedValue(null);
    const result = await service.apply('tenant-1', membershipId, roles, [
      { incomeId: 'income-x' },
    ]);

    expect(result[0]!.status).toBe('NOT_FOUND');
  });

  it('APPLY with liquidation conflict returns LIQUIDATION_CONFLICT', async () => {
    const tx = setupTx();
    tx.liquidation.findMany.mockResolvedValue([
      { buildingId: 'building-1', status: 'PUBLISHED' },
    ]);

    const result = await service.apply('tenant-1', membershipId, roles, [
      { incomeId: 'income-1' },
    ]);

    expect(result[0]!.status).toBe('LIQUIDATION_CONFLICT');
    expect(applicationsService.publishLegacyBackfillPlan).not.toHaveBeenCalled();
  });

  it('CANCELED liquidation does not conflict', async () => {
    setupTx();
    prisma.liquidation.findMany.mockResolvedValue([
      { buildingId: 'building-1', status: 'CANCELED' },
    ]);
    (applicationsService.publishLegacyBackfillPlan as jest.Mock).mockResolvedValue({
      incomeId: 'income-1',
      totalAmountMinor: 10000,
      applications: [{ id: 'app-1', destinationType: 'OFFSET_EXPENSES' }],
    });

    const result = await service.apply('tenant-1', membershipId, roles, [
      { incomeId: 'income-1' },
    ]);

    expect(result[0]!.status).toBe('MIGRATED');
  });

  it('rejects empty batch and batches over the limit', async () => {
    await expect(service.apply('tenant-1', membershipId, roles, [])).rejects.toThrow(
      BadRequestException,
    );
    const big = Array.from({ length: 101 }, (_, i) => ({ incomeId: `income-${i}` }));
    await expect(service.apply('tenant-1', membershipId, roles, big)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('processes batch items in deterministic incomeId order', async () => {
    setupTx();
    (applicationsService.publishLegacyBackfillPlan as jest.Mock).mockResolvedValue({
      incomeId: 'x',
      totalAmountMinor: 10000,
      applications: [{ id: 'app', destinationType: 'OFFSET_EXPENSES' }],
    });
    const items = [{ incomeId: 'b' }, { incomeId: 'a' }];

    const result = await service.apply('tenant-1', membershipId, roles, items);

    expect(result.map((r) => r.incomeId)).toEqual(['a', 'b']);
  });

  // ── Lazy materialization for liquidation ────────────────────────────────

  it('lazy materializes APPLY legacy income inside the liquidation tx', async () => {
    const tx = setupTx();
    tx.income.findMany.mockResolvedValue([makeIncome()]);
    (applicationsService.publishLegacyBackfillPlan as jest.Mock).mockResolvedValue({
      incomeId: 'income-1',
      totalAmountMinor: 10000,
      applications: [{ id: 'app-1', destinationType: 'OFFSET_EXPENSES' }],
    });

    await service.materializeForLiquidation({
      tx: tx as unknown as Prisma.TransactionClient,
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      period: '2026-08',
      membershipId,
    });

    expect(applicationsService.publishLegacyBackfillPlan).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        legacyDestination: IncomeDestination.APPLY_TO_EXPENSES,
        plan: [
          {
            destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
            fundId: null,
            amountMinor: 10000,
          },
        ],
      }),
    );
    expect(audit.createLogRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'INCOME_LEGACY_BACKFILL',
        metadata: expect.objectContaining({ mode: 'LIQUIDATION_AUTO_MATERIALIZE' }),
      }),
      tx,
    );
  });

  it('lazy skips income that gained applications concurrently (plan authoritative)', async () => {
    const tx = setupTx();
    tx.income.findMany.mockResolvedValue([makeIncome()]);
    tx.incomeApplication.count.mockResolvedValue(1);

    await service.materializeForLiquidation({
      tx: tx as unknown as Prisma.TransactionClient,
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      period: '2026-08',
      membershipId,
    });

    expect(applicationsService.publishLegacyBackfillPlan).not.toHaveBeenCalled();
  });

  it('lazy skips VOID income', async () => {
    const tx = setupTx();
    tx.income.findMany.mockResolvedValue([makeIncome({ status: IncomeStatus.VOID })]);

    await service.materializeForLiquidation({
      tx: tx as unknown as Prisma.TransactionClient,
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      period: '2026-08',
      membershipId,
    });

    expect(applicationsService.publishLegacyBackfillPlan).not.toHaveBeenCalled();
  });

  it('lazy throws LEGACY_INCOME_BACKFILL_LIQUIDATION_CONFLICT on historical conflict', async () => {
    const tx = setupTx();
    tx.income.findMany.mockResolvedValue([makeIncome()]);
    tx.liquidation.findMany.mockResolvedValue([
      { buildingId: 'building-1', status: 'PUBLISHED' },
    ]);

    await expect(
      service.materializeForLiquidation({
        tx: tx as unknown as Prisma.TransactionClient,
        tenantId: 'tenant-1',
        buildingId: 'building-1',
        period: '2026-08',
        membershipId,
      }),
    ).rejects.toMatchObject({
      response: { statusCode: 422, error: LEGACY_BACKFILL_LIQUIDATION_CONFLICT },
    });

    expect(applicationsService.publishLegacyBackfillPlan).not.toHaveBeenCalled();
  });

  it('lazy skips RESERVE_FUND/SPECIAL_FUND (never auto-materialized)', async () => {
    const tx = setupTx();
    const reserve = makeIncome({ id: 'r', destination: IncomeDestination.RESERVE_FUND });
    const special = makeIncome({ id: 's', destination: IncomeDestination.SPECIAL_FUND });
    tx.income.findMany.mockResolvedValue([reserve, special]);
    tx.income.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve([reserve, special].find((income) => income.id === where.id) ?? null),
    );

    await service.materializeForLiquidation({
      tx: tx as unknown as Prisma.TransactionClient,
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      period: '2026-08',
      membershipId,
    });

    expect(applicationsService.publishLegacyBackfillPlan).not.toHaveBeenCalled();
  });
});
