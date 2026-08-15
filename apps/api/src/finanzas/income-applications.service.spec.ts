import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  FundStatus,
  FundTransactionDirection,
  IncomeApplicationDestination,
  IncomeStatus,
  Prisma,
} from '@prisma/client';
import { IncomeApplicationsService } from './income-applications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';

const makeIncome = (overrides: Record<string, unknown> = {}) => ({
  id: 'income-1',
  tenantId: 'tenant-1',
  buildingId: null,
  period: '2026-08',
  categoryId: 'cat-1',
  amountMinor: 10000,
  currencyCode: 'USD',
  receivedDate: new Date('2026-08-10T00:00:00.000Z'),
  postedAt: new Date(),
  description: null,
  attachmentFileKey: null,
  status: IncomeStatus.RECORDED,
  scopeType: 'BUILDING',
  destination: 'APPLY_TO_EXPENSES',
  unitGroupId: null,
  functionalAmountMinor: null,
  functionalCurrencyCode: null,
  exchangeRateId: null,
  exchangeRateValue: null,
  exchangeRateDirection: null,
  exchangeRateEffectiveAt: null,
  conversionDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeApplication = (overrides: Record<string, unknown> = {}) => ({
  id: 'app-1',
  tenantId: 'tenant-1',
  incomeId: 'income-1',
  destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
  fundId: null,
  amountMinor: 7000,
  currencyCode: 'USD',
  createdByMembershipId: 'member-1',
  createdAt: new Date(),
  fundTransaction: null,
  ...overrides,
});

describe('IncomeApplicationsService', () => {
  let service: IncomeApplicationsService;
  let prisma: PrismaService;
  let audit: AuditService;
  let validators: FinanzasValidators;

  const prismaValue = {
    income: { findFirst: jest.fn() },
    incomeApplication: { findMany: jest.fn(), create: jest.fn() },
    fund: { findMany: jest.fn() },
    fundTransaction: { create: jest.fn() },
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
  };

  function mockTransaction() {
    (prismaValue.$transaction as jest.Mock).mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback({
        income: prismaValue.income,
        incomeApplication: prismaValue.incomeApplication,
        fund: prismaValue.fund,
        fundTransaction: prismaValue.fundTransaction,
        auditLog: { create: jest.fn() },
        $executeRaw: prismaValue.$executeRaw,
      }),
    );
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    (prismaValue.incomeApplication.create as jest.Mock).mockReset();
    (prismaValue.fundTransaction.create as jest.Mock).mockReset();
    mockTransaction();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IncomeApplicationsService,
        { provide: PrismaService, useValue: prismaValue },
        {
          provide: AuditService,
          useValue: {
            createLog: jest.fn(),
            createLogRequired: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: FinanzasValidators,
          useValue: {
            isAdminOrOperator: jest.fn().mockReturnValue(true),
          },
        },
      ],
    }).compile();

    service = module.get<IncomeApplicationsService>(IncomeApplicationsService);
    prisma = module.get<PrismaService>(PrismaService);
    audit = module.get<AuditService>(AuditService);
    validators = module.get<FinanzasValidators>(FinanzasValidators);

    (audit.createLogRequired as jest.Mock).mockResolvedValue(undefined);
  });

  const roles = ['TENANT_ADMIN'];

  const plan = (apps: Array<{ destinationType: IncomeApplicationDestination; fundId?: string; amountMinor: number }>) =>
    ({ applications: apps });

  // ── RBAC ────────────────────────────────────────────────────────────────

  describe('RBAC', () => {
    it('rejects non-admin users', async () => {
      (validators.isAdminOrOperator as jest.Mock).mockReturnValue(false);
      await expect(service.getPlan('tenant-1', 'income-1', ['RESIDENT'])).rejects.toThrow(ForbiddenException);
      await expect(
        service.createPlan('tenant-1', 'income-1', 'm', ['RESIDENT'], plan([{ destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 10000 }])),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── Lifecycle guards ────────────────────────────────────────────────────

  describe('lifecycle guards', () => {
    it('rejects a DRAFT income', async () => {
      (prisma.income.findFirst as jest.Mock).mockResolvedValue(makeIncome({ status: IncomeStatus.DRAFT }));
      await expect(
        service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([{ destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 10000 }])),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a VOID income', async () => {
      (prisma.income.findFirst as jest.Mock).mockResolvedValue(makeIncome({ status: IncomeStatus.VOID }));
      await expect(
        service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([{ destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 10000 }])),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects income from another tenant (not found)', async () => {
      (prisma.income.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(
        service.createPlan('tenant-1', 'income-x', 'member-1', roles, plan([{ destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 10000 }])),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.income.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'income-x', tenantId: 'tenant-1' } }),
      );
    });
  });

  // ── Exact sum invariant ─────────────────────────────────────────────────

  describe('exact sum invariant', () => {
    beforeEach(() => {
      (prisma.income.findFirst as jest.Mock).mockResolvedValue(makeIncome());
      (prisma.incomeApplication.findMany as jest.Mock).mockResolvedValue([]);
    });

    it('accepts an exact 70/30 split', async () => {
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([{ id: 'fund-1', status: FundStatus.ACTIVE }]);
      (prisma.incomeApplication.create as jest.Mock).mockResolvedValueOnce(
        makeApplication({ destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 }),
      );
      (prisma.incomeApplication.create as jest.Mock).mockResolvedValueOnce(
        makeApplication({ id: 'app-2', destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 3000, fundTransaction: { id: 'ft-1' } }),
      );
      (prisma.fundTransaction.create as jest.Mock).mockResolvedValue({ id: 'ft-1' });

      const result = await service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 3000 },
      ]));

      expect(result.totalAmountMinor).toBe(10000);
      expect(prisma.incomeApplication.create).toHaveBeenCalledTimes(2);
      expect(prisma.fundTransaction.create).toHaveBeenCalledTimes(1);
    });

    it('rejects an underallocation (sum < income)', async () => {
      await expect(
        service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
          { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
          { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 2999 },
        ])),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.incomeApplication.create).not.toHaveBeenCalled();
    });

    it('rejects an overallocation (sum > income)', async () => {
      await expect(
        service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
          { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
          { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 3001 },
        ])),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.incomeApplication.create).not.toHaveBeenCalled();
    });

    it('rejects amountMinor = 0', async () => {
      await expect(
        service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
          { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 0 },
          { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 10000 },
        ])),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects negative amountMinor', async () => {
      await expect(
        service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
          { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: -100 },
          { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 10100 },
        ])),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── Duplicate destinations ──────────────────────────────────────────────

  describe('duplicate destinations', () => {
    beforeEach(() => {
      (prisma.income.findFirst as jest.Mock).mockResolvedValue(makeIncome());
    });

    it('rejects two OFFSET_EXPENSES', async () => {
      await expect(
        service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
          { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 5000 },
          { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 5000 },
        ])),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects two CARRY_FORWARD', async () => {
      await expect(
        service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
          { destinationType: IncomeApplicationDestination.CARRY_FORWARD, amountMinor: 5000 },
          { destinationType: IncomeApplicationDestination.CARRY_FORWARD, amountMinor: 5000 },
        ])),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects two FUND towards the same fundId', async () => {
      await expect(
        service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
          { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 5000 },
          { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 5000 },
        ])),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows FUND to different funds', async () => {
      (prisma.incomeApplication.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([
        { id: 'fund-1', status: FundStatus.ACTIVE },
        { id: 'fund-2', status: FundStatus.ACTIVE },
      ]);
      (prisma.incomeApplication.create as jest.Mock).mockResolvedValueOnce(makeApplication({ id: 'a1', destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 4000, fundTransaction: { id: 'ft1' } }));
      (prisma.incomeApplication.create as jest.Mock).mockResolvedValueOnce(makeApplication({ id: 'a2', destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-2', amountMinor: 6000, fundTransaction: { id: 'ft2' } }));
      (prisma.fundTransaction.create as jest.Mock).mockResolvedValueOnce({ id: 'ft1' });
      (prisma.fundTransaction.create as jest.Mock).mockResolvedValueOnce({ id: 'ft2' });

      const result = await service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
        { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 4000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-2', amountMinor: 6000 },
      ]));

      expect(result.applications).toHaveLength(2);
    });
  });

  // ── Fund target validation ──────────────────────────────────────────────

  describe('fund target validation', () => {
    beforeEach(() => {
      (prisma.income.findFirst as jest.Mock).mockResolvedValue(makeIncome());
      (prisma.incomeApplication.findMany as jest.Mock).mockResolvedValue([]);
    });

    it('rejects FUND without fundId', async () => {
      await expect(
        service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
          { destinationType: IncomeApplicationDestination.FUND, amountMinor: 10000 },
        ])),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects OFFSET_EXPENSES with fundId', async () => {
      await expect(
        service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
          { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, fundId: 'fund-1', amountMinor: 10000 },
        ])),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a cross-tenant fund (not found in tenant)', async () => {
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([]);
      await expect(
        service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
          { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-other', amountMinor: 10000 },
        ])),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects an ARCHIVED fund', async () => {
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([{ id: 'fund-1', status: FundStatus.ARCHIVED }]);
      await expect(
        service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
          { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 10000 },
        ])),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── Plan idempotency ────────────────────────────────────────────────────

  describe('plan idempotency', () => {
    beforeEach(() => {
      (prisma.income.findFirst as jest.Mock).mockResolvedValue(makeIncome());
    });

    const existingPlan = () => [
      makeApplication({ destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 }),
      makeApplication({ id: 'app-2', destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 3000, fundTransaction: { id: 'ft-1' } }),
    ];

    it('returns the existing plan on the same-plan retry (no new mutations)', async () => {
      (prisma.incomeApplication.findMany as jest.Mock).mockResolvedValue(existingPlan());

      const result = await service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 3000 },
      ]));

      expect(result.applications).toHaveLength(2);
      expect(prisma.incomeApplication.create).not.toHaveBeenCalled();
      expect(prisma.fundTransaction.create).not.toHaveBeenCalled();
    });

    it('is order-insensitive for the same plan', async () => {
      (prisma.incomeApplication.findMany as jest.Mock).mockResolvedValue(existingPlan());

      const result = await service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
        { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 3000 },
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
      ]));

      expect(result.applications).toHaveLength(2);
      expect(prisma.incomeApplication.create).not.toHaveBeenCalled();
    });

    it('rejects a different plan with 409 Conflict', async () => {
      (prisma.incomeApplication.findMany as jest.Mock).mockResolvedValue(existingPlan());

      await expect(
        service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
          { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 6000 },
          { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 3000 },
          { destinationType: IncomeApplicationDestination.CARRY_FORWARD, amountMinor: 1000 },
        ])),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── Destination behavior ────────────────────────────────────────────────

  describe('destination behavior', () => {
    beforeEach(() => {
      (prisma.income.findFirst as jest.Mock).mockResolvedValue(makeIncome());
      (prisma.incomeApplication.findMany as jest.Mock).mockResolvedValue([]);
    });

    it('OFFSET_EXPENSES creates no FundTransaction', async () => {
      (prisma.incomeApplication.create as jest.Mock).mockResolvedValue(makeApplication());

      await service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 10000 },
      ]));

      expect(prisma.incomeApplication.create).toHaveBeenCalledTimes(1);
      expect(prisma.fundTransaction.create).not.toHaveBeenCalled();
    });

    it('CARRY_FORWARD creates no FundTransaction', async () => {
      (prisma.incomeApplication.create as jest.Mock).mockResolvedValue(
        makeApplication({ destinationType: IncomeApplicationDestination.CARRY_FORWARD }),
      );

      await service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
        { destinationType: IncomeApplicationDestination.CARRY_FORWARD, amountMinor: 10000 },
      ]));

      expect(prisma.fundTransaction.create).not.toHaveBeenCalled();
    });

    it('FUND creates an exact CREDIT linked to the application', async () => {
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([{ id: 'fund-1', status: FundStatus.ACTIVE }]);
      (prisma.incomeApplication.create as jest.Mock)
        .mockResolvedValueOnce(makeApplication({ destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 }))
        .mockResolvedValueOnce(
          makeApplication({ id: 'app-x', destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 3000, fundTransaction: { id: 'ft-x' } }),
        );
      (prisma.fundTransaction.create as jest.Mock).mockResolvedValue({ id: 'ft-x' });

      await service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 3000 },
      ]));

      expect(prisma.fundTransaction.create).toHaveBeenCalledTimes(1);
      const call = (prisma.fundTransaction.create as jest.Mock).mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(call[0].data).toEqual(expect.objectContaining({
        tenantId: 'tenant-1',
        fundId: 'fund-1',
        direction: FundTransactionDirection.CREDIT,
        amountMinor: 3000,
        currencyCode: 'USD', // == income.currencyCode
        incomeApplicationId: 'app-x',
        idempotencyKey: 'income-application:app-x',
        occurredAt: new Date('2026-08-10T00:00:00.000Z'), // == income.receivedDate
      }));
    });

    it('persists application currencyCode == income.currencyCode', async () => {
      (prisma.incomeApplication.create as jest.Mock).mockResolvedValue(makeApplication());

      await service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 10000 },
      ]));

      const call = (prisma.incomeApplication.create as jest.Mock).mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(call[0].data.currencyCode).toBe('USD');
    });
  });

  // ── Audit metadata null contract ────────────────────────────────────────

  describe('audit metadata null contract', () => {
    it('omits fundId from audit metadata when absent', async () => {
      (prisma.income.findFirst as jest.Mock).mockResolvedValue(makeIncome());
      (prisma.incomeApplication.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.incomeApplication.create as jest.Mock).mockResolvedValue(makeApplication());

      await service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 10000 },
      ]));

      expect(audit.createLogRequired).toHaveBeenCalledTimes(1);
      const call = (audit.createLogRequired as jest.Mock).mock.calls[0] as [{ metadata: Record<string, unknown> }];
      expect(call[0].action).toBe('INCOME_APPLICATIONS_CREATE');
      const apps = (call[0].metadata.applications as Array<Record<string, unknown>>);
      expect('fundId' in apps[0]!).toBe(false);
    });
  });
});
