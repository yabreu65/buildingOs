import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FinanzasValidators } from './finanzas.validators';
import { CurrencyConversionService } from './currency-conversion.service';
import { MovementAllocationService } from './movement-allocation.service';
import { ExpensesService } from './expenses.service';
import { IncomesService } from './incomes.service';
import { CreateExpenseDto, CreateIncomeDto } from './expense-ledger.dto';

function makePrismaMock() {
  const prismaValue = {
    $transaction: jest.fn(),
    $executeRaw: jest.fn().mockResolvedValue(1),
    expense: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    income: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    movementAllocation: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    expenseLedgerCategory: { findFirst: jest.fn() },
    vendor: { findFirst: jest.fn() },
    unitGroup: { findFirst: jest.fn() },
    liquidation: { findFirst: jest.fn().mockResolvedValue(null) },
    tenant: { findFirst: jest.fn() },
    exchangeRate: { findFirst: jest.fn() },
  };
  prismaValue.$transaction.mockImplementation(
    async (callback: (tx: typeof prismaValue) => unknown) => callback(prismaValue),
  );
  return prismaValue;
}

function makeExpense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'expense-1',
    tenantId: 'tenant-1',
    buildingId: null,
    period: '2026-08',
    liquidationPeriod: '2026-08',
    categoryId: 'expense-category-1',
    vendorId: null,
    amountMinor: 1000,
    currencyCode: 'ARS',
    invoiceDate: new Date('2026-08-01T00:00:00.000Z'),
    description: null,
    attachmentFileKey: null,
    status: 'DRAFT' as const,
    scopeType: 'TENANT_SHARED' as const,
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
    category: { name: 'Shared expenses' },
    vendor: null,
    ...overrides,
  };
}

function makeIncome(overrides: Record<string, unknown> = {}) {
  return {
    id: 'income-1',
    tenantId: 'tenant-1',
    buildingId: null,
    period: '2026-08',
    categoryId: 'income-category-1',
    amountMinor: 1000,
    currencyCode: 'ARS',
    receivedDate: new Date('2026-08-01T00:00:00.000Z'),
    description: null,
    attachmentFileKey: null,
    status: 'DRAFT' as const,
    scopeType: 'TENANT_SHARED' as const,
    destination: 'APPLY_TO_EXPENSES' as const,
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
    category: { name: 'Other income' },
    ...overrides,
  };
}

function buildExpenseService() {
  const prismaValue = makePrismaMock();
  const audit = { createLog: jest.fn().mockResolvedValue(undefined) };
  const movement = {
    validateAllocations: jest.fn(),
    createForExpenseInTx: jest.fn(),
  };
  const validators = {
    isAdminOrOperator: jest.fn().mockReturnValue(true),
    validateBuildingBelongsToTenant: jest.fn(),
  };
  const service = new ExpensesService(
    prismaValue as unknown as PrismaService,
    audit as unknown as AuditService,
    validators as unknown as FinanzasValidators,
    movement as unknown as MovementAllocationService,
    { convert: jest.fn() } as unknown as CurrencyConversionService,
  );
  return { prismaValue, movement, audit, service };
}

function buildIncomeService() {
  const prismaValue = makePrismaMock();
  const audit = { createLog: jest.fn().mockResolvedValue(undefined) };
  const movement = {
    validateAllocations: jest.fn(),
    createForIncomeInTx: jest.fn(),
  };
  const validators = {
    isAdminOrOperator: jest.fn().mockReturnValue(true),
  };
  const service = new IncomesService(
    prismaValue as unknown as PrismaService,
    audit as unknown as AuditService,
    validators as unknown as FinanzasValidators,
    movement as unknown as MovementAllocationService,
    { convert: jest.fn() } as unknown as CurrencyConversionService,
  );
  return { prismaValue, movement, audit, service };
}

const sharedExpenseDto: CreateExpenseDto = {
  period: '2026-08',
  categoryId: 'expense-category-1',
  amountMinor: 1000,
  currencyCode: 'ARS',
  invoiceDate: '2026-08-01',
  scopeType: 'TENANT_SHARED',
  allocations: [{ buildingId: 'building-1', percentage: 100 }],
};

const sharedIncomeDto: CreateIncomeDto = {
  period: '2026-08',
  categoryId: 'income-category-1',
  amountMinor: 1000,
  currencyCode: 'ARS',
  receivedDate: '2026-08-01',
  scopeType: 'TENANT_SHARED',
  allocations: [{ buildingId: 'building-1', percentage: 100 }],
};

describe('atomic movement lifecycle', () => {
  it('rolls back an Expense parent when allocation persistence fails', async () => {
    const { prismaValue, movement, audit, service } = buildExpenseService();
    prismaValue.expenseLedgerCategory.findFirst.mockResolvedValue({
      id: 'expense-category-1',
      catalogScope: 'CONDOMINIUM_COMMON',
    });
    prismaValue.expense.create.mockResolvedValue(makeExpense());
    movement.createForExpenseInTx.mockRejectedValue(new Error('allocation failure'));

    await expect(service.createExpense('tenant-1', 'member-1', ['TENANT_ADMIN'], sharedExpenseDto))
      .rejects.toThrow('allocation failure');

    expect(prismaValue.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaValue.expense.create).toHaveBeenCalledTimes(1);
    expect(movement.createForExpenseInTx).toHaveBeenCalledTimes(1);
    expect(audit.createLog).not.toHaveBeenCalled();
  });

  it('does not attempt allocations when an Expense parent fails', async () => {
    const { prismaValue, movement, service } = buildExpenseService();
    prismaValue.expenseLedgerCategory.findFirst.mockResolvedValue({
      id: 'expense-category-1',
      catalogScope: 'CONDOMINIUM_COMMON',
    });
    prismaValue.expense.create.mockRejectedValue(new Error('parent failure'));

    await expect(service.createExpense('tenant-1', 'member-1', ['TENANT_ADMIN'], sharedExpenseDto))
      .rejects.toThrow('parent failure');

    expect(movement.createForExpenseInTx).not.toHaveBeenCalled();
  });

  it('rejects an Expense amount change while allocations exist', async () => {
    const { prismaValue, service } = buildExpenseService();
    prismaValue.expense.findFirst.mockResolvedValue(makeExpense());
    prismaValue.movementAllocation.count.mockResolvedValue(1);

    await expect(service.updateExpense(
      'tenant-1',
      'expense-1',
      'member-1',
      ['TENANT_ADMIN'],
      { amountMinor: 2000 },
    )).rejects.toBeInstanceOf(ConflictException);

    expect(prismaValue.expense.update).not.toHaveBeenCalled();
  });

  it('allows an Expense amount change when no allocations exist', async () => {
    const { prismaValue, service } = buildExpenseService();
    prismaValue.expense.findFirst.mockResolvedValue(makeExpense());
    prismaValue.expense.update.mockResolvedValue(makeExpense());

    await service.updateExpense(
      'tenant-1',
      'expense-1',
      'member-1',
      ['TENANT_ADMIN'],
      { amountMinor: 2000 },
    );

    expect(prismaValue.expense.update).toHaveBeenCalledTimes(1);
  });

  it('emits Expense allocation audit only after the transaction commits', async () => {
    const { prismaValue, audit, movement, service } = buildExpenseService();
    prismaValue.expenseLedgerCategory.findFirst.mockResolvedValue({
      id: 'expense-category-1',
      catalogScope: 'CONDOMINIUM_COMMON',
    });
    prismaValue.expense.create.mockResolvedValue(makeExpense());

    let committed = false;
    prismaValue.$transaction.mockImplementation(async (callback: (tx: typeof prismaValue) => unknown) => {
      const result = await callback(prismaValue);
      committed = true;
      return result;
    });
    audit.createLog.mockImplementation(async () => {
      expect(committed).toBe(true);
    });

    await service.createExpense('tenant-1', 'member-1', ['TENANT_ADMIN'], sharedExpenseDto);

    expect(movement.createForExpenseInTx).toHaveBeenCalledTimes(1);
    expect(audit.createLog).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'EXPENSE_ALLOCATION_CREATE',
        entityType: 'MovementAllocation',
        entityId: 'expense-1',
        metadata: { allocationCount: 1, totalAmount: 1000 },
      }),
    );
    expect(audit.createLog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ action: 'EXPENSE_CREATE', entityId: 'expense-1' }),
    );
  });

  it('rolls back an Income parent when allocation persistence fails', async () => {
    const { prismaValue, movement, audit, service } = buildIncomeService();
    prismaValue.expenseLedgerCategory.findFirst.mockResolvedValue({
      id: 'income-category-1',
      movementType: 'INCOME',
    });
    prismaValue.income.create.mockResolvedValue(makeIncome());
    movement.createForIncomeInTx.mockRejectedValue(new Error('allocation failure'));

    await expect(service.createIncome('tenant-1', 'member-1', ['TENANT_ADMIN'], sharedIncomeDto))
      .rejects.toThrow('allocation failure');

    expect(prismaValue.$transaction).toHaveBeenCalledTimes(1);
    expect(movement.createForIncomeInTx).toHaveBeenCalledTimes(1);
    expect(audit.createLog).not.toHaveBeenCalled();
  });

  it('does not attempt allocations when an Income parent fails', async () => {
    const { prismaValue, movement, service } = buildIncomeService();
    prismaValue.expenseLedgerCategory.findFirst.mockResolvedValue({
      id: 'income-category-1',
      movementType: 'INCOME',
    });
    prismaValue.income.create.mockRejectedValue(new Error('parent failure'));

    await expect(service.createIncome('tenant-1', 'member-1', ['TENANT_ADMIN'], sharedIncomeDto))
      .rejects.toThrow('parent failure');

    expect(movement.createForIncomeInTx).not.toHaveBeenCalled();
  });

  it('rejects an Income currency change while allocations exist', async () => {
    const { prismaValue, service } = buildIncomeService();
    prismaValue.income.findFirst.mockResolvedValue(makeIncome());
    prismaValue.movementAllocation.count.mockResolvedValue(1);

    await expect(service.updateIncome(
      'tenant-1',
      'income-1',
      'member-1',
      ['TENANT_ADMIN'],
      { currencyCode: 'USD' },
    )).rejects.toBeInstanceOf(ConflictException);

    expect(prismaValue.income.update).not.toHaveBeenCalled();
  });

  it('emits Income allocation audit only after the transaction commits', async () => {
    const { prismaValue, audit, movement, service } = buildIncomeService();
    prismaValue.expenseLedgerCategory.findFirst.mockResolvedValue({
      id: 'income-category-1',
      movementType: 'INCOME',
    });
    prismaValue.income.create.mockResolvedValue(makeIncome());

    let committed = false;
    prismaValue.$transaction.mockImplementation(async (callback: (tx: typeof prismaValue) => unknown) => {
      const result = await callback(prismaValue);
      committed = true;
      return result;
    });
    audit.createLog.mockImplementation(async () => {
      expect(committed).toBe(true);
    });

    await service.createIncome('tenant-1', 'member-1', ['TENANT_ADMIN'], sharedIncomeDto);

    expect(movement.createForIncomeInTx).toHaveBeenCalledTimes(1);
    expect(audit.createLog).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'INCOME_ALLOCATION_CREATE',
        entityType: 'MovementAllocation',
        entityId: 'income-1',
        metadata: { allocationCount: 1, totalAmount: 1000 },
      }),
    );
    expect(audit.createLog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ action: 'INCOME_CREATE', entityId: 'income-1' }),
    );
  });

  it('passes the active transaction client to the Expense conversion snapshot', async () => {
    const root = makePrismaMock();
    const tx = makePrismaMock();
    root.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    tx.expense.findFirst.mockResolvedValue(makeExpense({
      vendorId: 'vendor-1',
      vendor: { name: 'Vendor' },
    }));
    tx.tenant.findFirst.mockResolvedValue({ id: 'tenant-1', functionalCurrency: 'ARS' });
    tx.expense.update.mockResolvedValue(makeExpense({ status: 'VALIDATED' }));
    const currencyConversion = {
      convert: jest.fn().mockResolvedValue({
        functionalAmount: 1000,
        functionalCurrency: 'ARS',
        sourceExchangeRateId: null,
        appliedRate: '1',
        direction: 'IDENTITY',
        sourceEffectiveAt: null,
        conversionDate: new Date('2026-08-01T00:00:00.000Z'),
      }),
    };
    const validators = { isAdminOrOperator: jest.fn().mockReturnValue(true) };
    const movement = { validateAllocations: jest.fn() };
    const service = new ExpensesService(
      root as unknown as PrismaService,
      { createLog: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService,
      validators as unknown as FinanzasValidators,
      movement as unknown as MovementAllocationService,
      currencyConversion as unknown as CurrencyConversionService,
    );

    await service.validateExpense('tenant-1', 'expense-1', 'member-1', ['TENANT_ADMIN']);

    expect(root.tenant.findFirst).not.toHaveBeenCalled();
    expect(tx.tenant.findFirst).toHaveBeenCalledTimes(1);
    expect(currencyConversion.convert).toHaveBeenCalledWith(expect.any(Object), tx);
  });

  it('passes the active transaction client to the Income conversion snapshot', async () => {
    const root = makePrismaMock();
    const tx = makePrismaMock();
    root.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    tx.income.findFirst.mockResolvedValue(makeIncome());
    tx.tenant.findFirst.mockResolvedValue({ id: 'tenant-1', functionalCurrency: 'ARS' });
    tx.income.update.mockResolvedValue(makeIncome({ status: 'RECORDED' }));
    const currencyConversion = {
      convert: jest.fn().mockResolvedValue({
        functionalAmount: 1000,
        functionalCurrency: 'ARS',
        sourceExchangeRateId: null,
        appliedRate: '1',
        direction: 'IDENTITY',
        sourceEffectiveAt: null,
        conversionDate: new Date('2026-08-01T00:00:00.000Z'),
      }),
    };
    const validators = { isAdminOrOperator: jest.fn().mockReturnValue(true) };
    const movement = { validateAllocations: jest.fn() };
    const service = new IncomesService(
      root as unknown as PrismaService,
      { createLog: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService,
      validators as unknown as FinanzasValidators,
      movement as unknown as MovementAllocationService,
      currencyConversion as unknown as CurrencyConversionService,
    );

    await service.recordIncome('tenant-1', 'income-1', 'member-1', ['TENANT_ADMIN']);

    expect(root.tenant.findFirst).not.toHaveBeenCalled();
    expect(tx.tenant.findFirst).toHaveBeenCalledTimes(1);
    expect(currencyConversion.convert).toHaveBeenCalledWith(expect.any(Object), tx);
  });

  it('uses the active transaction client for Expense period checks', async () => {
    const root = makePrismaMock();
    const tx = makePrismaMock();
    root.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    tx.expense.findFirst.mockResolvedValue(makeExpense({
      buildingId: 'building-1',
      scopeType: 'BUILDING',
      vendorId: 'vendor-1',
      vendor: { name: 'Vendor' },
    }));
    tx.liquidation.findFirst.mockResolvedValue(null);
    tx.expense.update.mockResolvedValue(makeExpense({
      buildingId: 'building-1',
      scopeType: 'BUILDING',
      vendorId: 'vendor-1',
      vendor: { name: 'Vendor' },
    }));
    const validators = { isAdminOrOperator: jest.fn().mockReturnValue(true) };
    const service = new ExpensesService(
      root as unknown as PrismaService,
      { createLog: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService,
      validators as unknown as FinanzasValidators,
      { validateAllocations: jest.fn() } as unknown as MovementAllocationService,
      { convert: jest.fn() } as unknown as CurrencyConversionService,
    );

    await service.updateExpense(
      'tenant-1',
      'expense-1',
      'member-1',
      ['TENANT_ADMIN'],
      { description: 'metadata update' },
    );

    expect(root.liquidation.findFirst).not.toHaveBeenCalled();
    expect(tx.liquidation.findFirst).toHaveBeenCalledTimes(1);
  });
});
