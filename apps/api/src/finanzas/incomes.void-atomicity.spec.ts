import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FundTransactionDirection, IncomeStatus } from '@prisma/client';
import { IncomesService } from './incomes.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { MovementAllocationService } from './movement-allocation.service';
import { CurrencyConversionService } from './currency-conversion.service';

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
  category: { name: 'Parking' },
  ...overrides,
});

describe('IncomesService voidIncome atomicity (FIN-03)', () => {
  let service: IncomesService;
  let prisma: PrismaService;
  let audit: AuditService;
  let validators: FinanzasValidators;

  const prismaValue = {
    income: { findFirst: jest.fn(), update: jest.fn() },
    incomeApplication: { findMany: jest.fn() },
    fund: { findMany: jest.fn() },
    fundTransaction: { create: jest.fn(), groupBy: jest.fn() },
    tenant: { findFirst: jest.fn() },
    exchangeRate: { findFirst: jest.fn() },
    expenseLedgerCategory: { findFirst: jest.fn() },
    unitGroup: { findFirst: jest.fn() },
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
        tenant: prismaValue.tenant,
        exchangeRate: prismaValue.exchangeRate,
        expenseLedgerCategory: prismaValue.expenseLedgerCategory,
        unitGroup: prismaValue.unitGroup,
        auditLog: { create: jest.fn() },
        $executeRaw: prismaValue.$executeRaw,
      }),
    );
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    (prismaValue.fundTransaction.create as jest.Mock).mockReset();
    mockTransaction();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IncomesService,
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
          useValue: { isAdminOrOperator: jest.fn().mockReturnValue(true) },
        },
        { provide: MovementAllocationService, useValue: {} },
        { provide: CurrencyConversionService, useValue: { convert: jest.fn() } },
      ],
    }).compile();

    service = module.get<IncomesService>(IncomesService);
    prisma = module.get<PrismaService>(PrismaService);
    audit = module.get<AuditService>(AuditService);
    validators = module.get<FinanzasValidators>(FinanzasValidators);

    (audit.createLogRequired as jest.Mock).mockResolvedValue(undefined);
  });

  const roles = ['TENANT_ADMIN'];

  it('rejects non-admin users', async () => {
    (validators.isAdminOrOperator as jest.Mock).mockReturnValue(false);
    await expect(service.voidIncome('tenant-1', 'income-1', 'm', ['RESIDENT'])).rejects.toThrow(ForbiddenException);
  });

  it('rejects income from another tenant (not found)', async () => {
    (prisma.income.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.voidIncome('tenant-1', 'income-x', 'm', roles)).rejects.toThrow(NotFoundException);
  });

  it('is idempotent when the income is already VOID (no new mutations)', async () => {
    (prisma.income.findFirst as jest.Mock).mockResolvedValue(makeIncome({ status: IncomeStatus.VOID }));

    const result = await service.voidIncome('tenant-1', 'income-1', 'member-1', roles);

    expect(result.status).toBe('VOID');
    expect(prisma.incomeApplication.findMany).not.toHaveBeenCalled();
    expect(prisma.fundTransaction.create).not.toHaveBeenCalled();
    expect(audit.createLogRequired).not.toHaveBeenCalled();
  });

  it('voids an income without applications (no fund mutations)', async () => {
    (prisma.income.findFirst as jest.Mock).mockResolvedValue(makeIncome());
    (prisma.incomeApplication.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.income.update as jest.Mock).mockResolvedValue(makeIncome({ status: IncomeStatus.VOID }));

    const result = await service.voidIncome('tenant-1', 'income-1', 'member-1', roles);

    expect(result.status).toBe('VOID');
    expect(prisma.fundTransaction.create).not.toHaveBeenCalled();
    expect(audit.createLogRequired).toHaveBeenCalledTimes(1); // INCOME_VOID
  });

  it('reverses FUND application CREDITs on void (ledger immutable, reversal created)', async () => {
    (prisma.income.findFirst as jest.Mock).mockResolvedValue(makeIncome());
    (prisma.fund.findMany as jest.Mock).mockResolvedValue([{ id: 'fund-1', status: 'ACTIVE' }]);
    (prisma.fundTransaction.groupBy as jest.Mock)
      .mockResolvedValueOnce([{ currencyCode: 'USD', _sum: { amountMinor: 3000 } }])
      .mockResolvedValueOnce([]);
    (prisma.incomeApplication.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'app-1',
        fundId: 'fund-1',
        fundTransaction: {
          id: 'ft-1',
          fundId: 'fund-1',
          direction: FundTransactionDirection.CREDIT,
          amountMinor: 3000,
          currencyCode: 'USD',
          reversalOfTransactionId: null,
        },
      },
    ]);
    (prisma.fundTransaction.create as jest.Mock).mockResolvedValue({ id: 'ft-rev' });
    (prisma.income.update as jest.Mock).mockResolvedValue(makeIncome({ status: IncomeStatus.VOID }));

    await service.voidIncome('tenant-1', 'income-1', 'member-1', roles);

    expect(prisma.fundTransaction.create).toHaveBeenCalledTimes(1);
    const call = (prisma.fundTransaction.create as jest.Mock).mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(call[0].data).toEqual(expect.objectContaining({
      tenantId: 'tenant-1',
      fundId: 'fund-1',
      direction: FundTransactionDirection.DEBIT, // opuesto al CREDIT original
      amountMinor: 3000,
      currencyCode: 'USD',
      reversalOfTransactionId: 'ft-1',
    }));
    // FUND_TRANSACTION_REVERSE + INCOME_VOID audits required
    expect(audit.createLogRequired).toHaveBeenCalledTimes(2);
    const actions = (audit.createLogRequired as jest.Mock).mock.calls.map(
      (call: [{ action: string }]) => call[0].action,
    );
    expect(actions).toContain('FUND_TRANSACTION_REVERSE');
    expect(actions).toContain('INCOME_VOID');
  });

  it('does not double-reverse an already-reversed transaction', async () => {
    (prisma.income.findFirst as jest.Mock).mockResolvedValue(makeIncome());
    (prisma.fund.findMany as jest.Mock).mockResolvedValue([{ id: 'fund-1', status: 'ACTIVE' }]);
    (prisma.incomeApplication.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'app-1',
        fundId: 'fund-1',
        fundTransaction: {
          id: 'ft-1',
          fundId: 'fund-1',
          direction: FundTransactionDirection.CREDIT,
          amountMinor: 3000,
          currencyCode: 'USD',
          reversalOfTransactionId: 'ft-rev-existing', // ya reversado
        },
      },
    ]);
    (prisma.income.update as jest.Mock).mockResolvedValue(makeIncome({ status: IncomeStatus.VOID }));

    await service.voidIncome('tenant-1', 'income-1', 'member-1', roles);

    expect(prisma.fundTransaction.create).not.toHaveBeenCalled();
    expect(audit.createLogRequired).toHaveBeenCalledTimes(1); // solo INCOME_VOID
  });
});
