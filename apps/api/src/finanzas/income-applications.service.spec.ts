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
  IncomeDestination,
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
    incomePolicy: { findUnique: jest.fn() },
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
        incomePolicy: prismaValue.incomePolicy,
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

  // ── Required FUND CREDIT audit (FIN-03R BLOCKER A) ─────────────────────

  describe('required fund credit audit', () => {
    beforeEach(() => {
      (prisma.income.findFirst as jest.Mock).mockResolvedValue(makeIncome());
      (prisma.incomeApplication.findMany as jest.Mock).mockResolvedValue([]);
    });

    it('emits exactly one FUND_TRANSACTION_CREATE per FUND destination plus the plan audit', async () => {
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

      const calls = (audit.createLogRequired as jest.Mock).mock.calls.map(
        (call: [{ action: string; entityId: string; metadata: Record<string, unknown> }]) => ({
          action: call[0].action,
          entityId: call[0].entityId,
          metadata: call[0].metadata,
        }),
      );
      expect(calls).toHaveLength(2);
      const txAudit = calls.find((c) => c.action === 'FUND_TRANSACTION_CREATE');
      expect(txAudit).toBeDefined();
      expect(txAudit!.entityId).toBe('ft-x');
      expect(txAudit!.metadata.fundId).toBe('fund-1');
      expect(txAudit!.metadata.direction).toBe('CREDIT');
      expect(txAudit!.metadata.amountMinor).toBe(3000);
      expect(txAudit!.metadata.currencyCode).toBe('USD');
      expect(txAudit!.metadata.idempotencyKey).toBe('income-application:app-x');
      expect(txAudit!.metadata.incomeApplicationId).toBe('app-x');
      const planAudit = calls.find((c) => c.action === 'INCOME_APPLICATIONS_CREATE');
      expect(planAudit).toBeDefined();
    });

    it('emits 3 FUND_TRANSACTION_CREATE for a 3-FUND plan plus the plan audit', async () => {
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([
        { id: 'fund-1', status: FundStatus.ACTIVE },
        { id: 'fund-2', status: FundStatus.ACTIVE },
        { id: 'fund-3', status: FundStatus.ACTIVE },
      ]);
      (prisma.incomeApplication.create as jest.Mock)
        .mockResolvedValueOnce(makeApplication({ id: 'a1', destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 3000, fundTransaction: { id: 'ft1' } }))
        .mockResolvedValueOnce(makeApplication({ id: 'a2', destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-2', amountMinor: 3000, fundTransaction: { id: 'ft2' } }))
        .mockResolvedValueOnce(makeApplication({ id: 'a3', destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-3', amountMinor: 4000, fundTransaction: { id: 'ft3' } }));
      (prisma.fundTransaction.create as jest.Mock)
        .mockResolvedValueOnce({ id: 'ft1' })
        .mockResolvedValueOnce({ id: 'ft2' })
        .mockResolvedValueOnce({ id: 'ft3' });

      await service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
        { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 3000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-2', amountMinor: 3000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-3', amountMinor: 4000 },
      ]));

      const actions = (audit.createLogRequired as jest.Mock).mock.calls.map(
        (call: [{ action: string }]) => call[0].action,
      );
      expect(actions.filter((a) => a === 'FUND_TRANSACTION_CREATE')).toHaveLength(3);
      expect(actions.filter((a) => a === 'INCOME_APPLICATIONS_CREATE')).toHaveLength(1);
    });

    it('does not emit FUND_TRANSACTION_CREATE audits on a same-plan retry', async () => {
      (prisma.incomeApplication.findMany as jest.Mock).mockResolvedValue([
        makeApplication({ destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 }),
        makeApplication({ id: 'app-2', destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 3000, fundTransaction: { id: 'ft-1' } }),
      ]);

      await service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
        { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
        { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 3000 },
      ]));

      expect(audit.createLogRequired).not.toHaveBeenCalled();
      expect(prisma.fundTransaction.create).not.toHaveBeenCalled();
    });

    it('rolls back everything when the required FUND_TRANSACTION_CREATE audit fails', async () => {
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([{ id: 'fund-1', status: FundStatus.ACTIVE }]);
      (prisma.incomeApplication.create as jest.Mock)
        .mockResolvedValueOnce(makeApplication({ destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 }))
        .mockResolvedValueOnce(
          makeApplication({ id: 'app-x', destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 3000, fundTransaction: { id: 'ft-x' } }),
        );
      (prisma.fundTransaction.create as jest.Mock).mockResolvedValue({ id: 'ft-x' });
      (audit.createLogRequired as jest.Mock).mockRejectedValue(new Error('FORCED_AUDIT_FAILURE'));

      await expect(
        service.createPlan('tenant-1', 'income-1', 'member-1', roles, plan([
          { destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 },
          { destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 3000 },
        ])),
      ).rejects.toThrow('FORCED_AUDIT_FAILURE');
      // el error se propaga → la transacción (mock) haría rollback real en PostgreSQL
    });
  });

  // ── applyPolicy (FIN-05) ────────────────────────────────────────────────

  describe('applyPolicy', () => {
    const policyVersion = {
      id: 'policy-version-1',
      version: 1,
      status: 'ACTIVE',
      rules: [
        { id: 'r1', destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, fundId: null, percentageBasisPoints: 7000 },
        { id: 'r2', destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', percentageBasisPoints: 3000 },
      ],
    };

    beforeEach(() => {
      (prisma.income.findFirst as jest.Mock).mockResolvedValue(makeIncome());
      (prisma.incomeApplication.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.incomePolicy.findUnique as jest.Mock).mockResolvedValue({
        id: 'policy-1',
        tenantId: 'tenant-1',
        categoryId: 'cat-1',
        versions: [policyVersion],
      });
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([{ id: 'fund-1', status: FundStatus.ACTIVE }]);
      (prisma.incomeApplication.create as jest.Mock).mockImplementation(({ data }) =>
        Promise.resolve(makeApplication({
          id: 'app-' + data.destinationType + '-' + (data.fundId ?? 'nf'),
          destinationType: data.destinationType,
          fundId: data.fundId,
          amountMinor: data.amountMinor,
          policyVersionId: data.policyVersionId,
          fundTransaction: data.destinationType === IncomeApplicationDestination.FUND ? { id: 'ft-' + data.fundId } : null,
        })),
      );
      (prisma.fundTransaction.create as jest.Mock).mockResolvedValue({ id: 'ft-1' });
    });

    it('applies a policy to a RECORDED income generating exact amounts', async () => {
      const result = await service.applyPolicy('tenant-1', 'income-1', 'member-1', roles);

      expect(result.totalAmountMinor).toBe(10000);
      expect(prisma.incomeApplication.create).toHaveBeenCalledTimes(2);
      expect(prisma.fundTransaction.create).toHaveBeenCalledTimes(1);
      const calls = (prisma.incomeApplication.create as jest.Mock).mock.calls.map((c: [{ data: Record<string, unknown> }]) => c[0].data);
      const fundCall = calls.find((d) => d.destinationType === 'FUND');
      const offsetCall = calls.find((d) => d.destinationType === 'OFFSET_EXPENSES');
      expect(fundCall?.amountMinor).toBe(3000);
      expect(fundCall?.policyVersionId).toBe('policy-version-1');
      expect(offsetCall?.amountMinor).toBe(7000);
      expect(offsetCall?.policyVersionId).toBe('policy-version-1');
    });

    it('applies a 100% CARRY_FORWARD policy with no FundTransaction', async () => {
      (prisma.incomePolicy.findUnique as jest.Mock).mockResolvedValue({
        id: 'policy-1',
        versions: [{ id: 'pv2', version: 1, status: 'ACTIVE', rules: [{ id: 'r1', destinationType: IncomeApplicationDestination.CARRY_FORWARD, fundId: null, percentageBasisPoints: 10000 }] }],
      });
      (prisma.incomeApplication.create as jest.Mock).mockImplementation(({ data }) =>
        Promise.resolve(makeApplication({ id: 'app-carry', destinationType: data.destinationType, fundId: data.fundId, amountMinor: data.amountMinor, policyVersionId: data.policyVersionId })),
      );

      const result = await service.applyPolicy('tenant-1', 'income-1', 'member-1', roles);

      expect(result.applications[0]!.amountMinor).toBe(10000);
      expect(prisma.fundTransaction.create).not.toHaveBeenCalled();
    });

    it('rejects a DRAFT income', async () => {
      (prisma.income.findFirst as jest.Mock).mockResolvedValue(makeIncome({ status: IncomeStatus.DRAFT }));
      await expect(service.applyPolicy('tenant-1', 'income-1', 'member-1', roles)).rejects.toThrow(BadRequestException);
    });

    it('rejects a VOID income', async () => {
      (prisma.income.findFirst as jest.Mock).mockResolvedValue(makeIncome({ status: IncomeStatus.VOID }));
      await expect(service.applyPolicy('tenant-1', 'income-1', 'member-1', roles)).rejects.toThrow(BadRequestException);
    });

    it('rejects when there is no ACTIVE policy for the category', async () => {
      (prisma.incomePolicy.findUnique as jest.Mock).mockResolvedValue({ id: 'policy-1', versions: [] });
      await expect(service.applyPolicy('tenant-1', 'income-1', 'member-1', roles)).rejects.toThrow(BadRequestException);
    });

    it('is idempotent when the existing plan equals the policy-generated plan', async () => {
      (prisma.incomeApplication.findMany as jest.Mock).mockResolvedValue([
        makeApplication({ destinationType: IncomeApplicationDestination.OFFSET_EXPENSES, amountMinor: 7000 }),
        makeApplication({ id: 'app-2', destinationType: IncomeApplicationDestination.FUND, fundId: 'fund-1', amountMinor: 3000, fundTransaction: { id: 'ft-1' } }),
      ]);

      const result = await service.applyPolicy('tenant-1', 'income-1', 'member-1', roles);

      expect(result.applications).toHaveLength(2);
      expect(prisma.incomeApplication.create).not.toHaveBeenCalled();
      expect(prisma.fundTransaction.create).not.toHaveBeenCalled();
    });

    it('rejects a conflicting existing plan', async () => {
      (prisma.incomeApplication.findMany as jest.Mock).mockResolvedValue([
        makeApplication({ destinationType: IncomeApplicationDestination.CARRY_FORWARD, amountMinor: 10000 }),
      ]);
      await expect(service.applyPolicy('tenant-1', 'income-1', 'member-1', roles)).rejects.toThrow(ConflictException);
    });

    it('rejects when a small income makes a rule zero (rounding guard)', async () => {
      (prisma.income.findFirst as jest.Mock).mockResolvedValue(makeIncome({ amountMinor: 1 }));
      await expect(service.applyPolicy('tenant-1', 'income-1', 'member-1', roles)).rejects.toThrow(BadRequestException);
    });

    it('handles the 10001 rounding case deterministically (largest remainder)', async () => {
      (prisma.income.findFirst as jest.Mock).mockResolvedValue(makeIncome({ amountMinor: 10001 }));
      (prisma.incomeApplication.create as jest.Mock).mockImplementation(({ data }) =>
        Promise.resolve(makeApplication({ id: 'app-x', destinationType: data.destinationType, fundId: data.fundId, amountMinor: data.amountMinor, policyVersionId: data.policyVersionId, fundTransaction: data.destinationType === IncomeApplicationDestination.FUND ? { id: 'ft-1' } : null })),
      );

      const result = await service.applyPolicy('tenant-1', 'income-1', 'member-1', roles);

      const amounts = result.applications.map((a) => a.amountMinor).sort((x, y) => x - y);
      expect(amounts).toEqual([3000, 7001]); // 7000.7→7000 + remainder 1 → 7001; 3000.3→3000
      expect(result.totalAmountMinor).toBe(10001);
    });

    it('rejects when the policy references an archived fund at apply time', async () => {
      (prisma.fund.findMany as jest.Mock).mockResolvedValue([{ id: 'fund-1', status: FundStatus.ARCHIVED }]);
      await expect(service.applyPolicy('tenant-1', 'income-1', 'member-1', roles)).rejects.toThrow(BadRequestException);
    });

    it('persists policyVersionId provenance on the FundTransaction audit', async () => {
      await service.applyPolicy('tenant-1', 'income-1', 'member-1', roles);

      const txAuditCalls = (audit.createLogRequired as jest.Mock).mock.calls.filter(
        (call: [{ action: string }]) => call[0].action === 'FUND_TRANSACTION_CREATE',
      );
      expect(txAuditCalls).toHaveLength(1);
      expect(txAuditCalls[0]![0].metadata.policyVersionId).toBe('policy-version-1');
    });
  });

  describe('FIN-04 publishLegacyBackfillPlan', () => {
    const legacyIncome = {
      id: 'income-legacy',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      period: '2026-08',
      scopeType: 'BUILDING',
      status: 'RECORDED',
      destination: 'APPLY_TO_EXPENSES',
      amountMinor: 5000,
      currencyCode: 'USD',
      receivedDate: new Date('2026-08-10T00:00:00.000Z'),
      categoryId: 'cat-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('APPLY legacy creates an OFFSET application with legacyDestination provenance', async () => {
      (prismaValue.income.findFirst as jest.Mock).mockResolvedValue(legacyIncome);
      (prismaValue.incomeApplication.findMany as jest.Mock).mockResolvedValue([]);
      (prismaValue.incomeApplication.create as jest.Mock).mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'app-legacy', ...data }),
      );

      await service.publishLegacyBackfillPlan(
        prismaValue as unknown as Parameters<typeof service.publishLegacyBackfillPlan>[0],
        {
          tenantId: 'tenant-1',
          incomeId: 'income-legacy',
          membershipId: 'member-1',
          legacyDestination: IncomeDestination.APPLY_TO_EXPENSES,
          plan: [
            {
              destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
              fundId: null,
              amountMinor: 5000,
            },
          ],
        },
      );

      expect(prismaValue.incomeApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
            fundId: null,
            amountMinor: 5000,
            currencyCode: 'USD',
            policyVersionId: null,
            legacyDestination: IncomeDestination.APPLY_TO_EXPENSES,
          }),
        }),
      );
    });

    it('RESERVE legacy creates a FUND application with fundTransactionOccurredAt = receivedDate', async () => {
      (prismaValue.income.findFirst as jest.Mock).mockResolvedValue(legacyIncome);
      (prismaValue.incomeApplication.findMany as jest.Mock).mockResolvedValue([]);
      (prismaValue.incomeApplication.create as jest.Mock).mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'app-fund', ...data }),
      );
      (prismaValue.fundTransaction.create as jest.Mock).mockResolvedValue({
        id: 'ft-1',
        fundId: 'fund-1',
        direction: FundTransactionDirection.CREDIT,
        amountMinor: 5000,
        currencyCode: 'USD',
        occurredAt: legacyIncome.receivedDate,
      });

      await service.publishLegacyBackfillPlan(
        prismaValue as unknown as Parameters<typeof service.publishLegacyBackfillPlan>[0],
        {
          tenantId: 'tenant-1',
          incomeId: 'income-legacy',
          membershipId: 'member-1',
          legacyDestination: IncomeDestination.RESERVE_FUND,
          plan: [
            {
              destinationType: IncomeApplicationDestination.FUND,
              fundId: 'fund-1',
              amountMinor: 5000,
            },
          ],
        },
      );

      expect(prismaValue.incomeApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            destinationType: IncomeApplicationDestination.FUND,
            fundId: 'fund-1',
            legacyDestination: IncomeDestination.RESERVE_FUND,
          }),
        }),
      );
      expect(prismaValue.fundTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            occurredAt: legacyIncome.receivedDate, // recibido, no hoy
            incomeApplicationId: 'app-fund',
          }),
        }),
      );
    });

    it('rejects a plan whose sum does not match the income amount', async () => {
      (prismaValue.income.findFirst as jest.Mock).mockResolvedValue(legacyIncome);

      await expect(
        service.publishLegacyBackfillPlan(
          prismaValue as unknown as Parameters<typeof service.publishLegacyBackfillPlan>[0],
          {
            tenantId: 'tenant-1',
            incomeId: 'income-legacy',
            membershipId: 'member-1',
            legacyDestination: IncomeDestination.APPLY_TO_EXPENSES,
            plan: [
              {
                destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
                fundId: null,
                amountMinor: 4000,
              },
            ],
          },
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prismaValue.incomeApplication.create).not.toHaveBeenCalled();
    });

    it('is idempotent when the same legacy plan already exists', async () => {
      (prismaValue.income.findFirst as jest.Mock).mockResolvedValue(legacyIncome);
      (prismaValue.incomeApplication.findMany as jest.Mock).mockResolvedValue([
        makeApplication({
          destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
          amountMinor: 5000,
          currencyCode: 'USD',
        }),
      ]);

      const result = await service.publishLegacyBackfillPlan(
        prismaValue as unknown as Parameters<typeof service.publishLegacyBackfillPlan>[0],
        {
          tenantId: 'tenant-1',
          incomeId: 'income-legacy',
          membershipId: 'member-1',
          legacyDestination: IncomeDestination.APPLY_TO_EXPENSES,
          plan: [
            {
              destinationType: IncomeApplicationDestination.OFFSET_EXPENSES,
              fundId: null,
              amountMinor: 5000,
            },
          ],
        },
      );

      expect(result.applications).toHaveLength(1);
      expect(prismaValue.incomeApplication.create).not.toHaveBeenCalled();
    });
  });
});
