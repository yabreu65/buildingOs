import {
  FINANCE_INVENTORY_ENTITIES,
  createPrismaReadOnlyFinanceInventoryAdapter,
  createReadOnlyFinanceInventoryAdapter,
  rejectMutationAttempt,
} from './adapter';
import { classifyFinanceCondition } from './classifier';
import { FinanceInventoryEntity, FinancePageReader } from './contracts';
import { PrismaService } from '../../prisma/prisma.service';

function reader(entity: FinanceInventoryEntity, operations: string[]): FinancePageReader {
  return {
    listPage: jest.fn(async ({ limit }) => {
      operations.push(`read:${entity}:${limit}`);
      return { records: [], nextCursor: undefined };
    }),
  };
}

function emptyPrisma(overrides: Record<string, Record<string, unknown> | undefined>): PrismaService {
  const delegate = { findMany: jest.fn().mockResolvedValue([]) };
  return {
    liquidation: { ...delegate, ...overrides.liquidation },
    charge: { ...delegate, ...overrides.charge },
    fund: { ...delegate, ...overrides.fund },
    fundTransaction: { ...delegate, ...overrides.fundTransaction },
    payment: { ...delegate, ...overrides.payment },
    paymentAllocation: { ...delegate, ...overrides.paymentAllocation },
    expense: { ...delegate, ...overrides.expense },
    adjustment: { ...delegate, ...overrides.adjustment },
    income: { ...delegate, ...overrides.income },
    incomeApplication: { ...delegate, ...overrides.incomeApplication },
    movementAllocation: { ...delegate, ...overrides.movementAllocation },
    liquidationIncomeOffset: { ...delegate, ...overrides.liquidationIncomeOffset },
    tenant: { ...delegate, ...overrides.tenant },
    unit: { ...delegate, ...overrides.unit },
  } as unknown as PrismaService;
}

function paymentSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    amount: 100,
    functionalAmountMinor: null,
    functionalCurrencyCode: null,
    exchangeRateId: null,
    exchangeRateValue: null,
    exchangeRateDirection: null,
    exchangeRateEffectiveAt: null,
    conversionDate: null,
    ...overrides,
  };
}

describe('read-only historical finance adapter', () => {
  it('exposes page readers for every covered entity and performs reads only', async () => {
    const operations: string[] = [];
    const readers = Object.fromEntries(
      FINANCE_INVENTORY_ENTITIES.map((entity) => [entity, reader(entity, operations)]),
    ) as Record<FinanceInventoryEntity, FinancePageReader>;
    const adapter = createReadOnlyFinanceInventoryAdapter(readers);

    await Promise.all(FINANCE_INVENTORY_ENTITIES.map((entity) => adapter.listPage(entity, { limit: 100 })));

    expect(operations).toEqual(FINANCE_INVENTORY_ENTITIES.map((entity) => `read:${entity}:100`));
    expect('create' in adapter).toBe(false);
    expect('update' in adapter).toBe(false);
    expect('delete' in adapter).toBe(false);
  });

  it.each(['create', 'update', 'delete', 'upsert', 'repair', 'backfill'])('rejects attempted %s operations', (operation) => {
    expect(() => rejectMutationAttempt(operation)).toThrow(`Historical finance inventory rejects ${operation} operations`);
  });

  it('uses bounded ID-cursor Prisma reads and preserves same-currency allocation evidence', async () => {
    const findMany = jest.fn().mockResolvedValue([{
      id: 'allocation-001', tenantId: 'tenant-a', paymentId: 'payment-001', chargeId: 'charge-001', amount: 100, paymentOriginalAmountMinor: null,
      payment: { id: 'payment-001', tenantId: 'tenant-a', buildingId: 'building-a', unitId: 'unit-a', currency: 'ARS', ...paymentSnapshot() },
      charge: { id: 'charge-001', tenantId: 'tenant-a', buildingId: 'building-a', unitId: 'unit-a', currency: 'ARS' },
    }]);
    const adapter = createPrismaReadOnlyFinanceInventoryAdapter(emptyPrisma({ paymentAllocation: { findMany } }));

    await expect(adapter.listPage('paymentAllocations', { limit: 2, cursor: 'allocation-000' })).resolves.toMatchObject({
      records: [{
        id: 'allocation-001', createdSequence: 0, tenantToken: 'tenant-a', currencyCode: 'ARS', currencyStatuses: ['CANONICAL_CURRENT'],
        currencyCompatible: true, invariantValid: true, requiresCounterpart: true, counterpartEntity: 'payments', counterpartId: 'payment-001', requiresCurrency: true,
      }],
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { gt: 'allocation-000' } }, orderBy: { id: 'asc' }, take: 2 }));
  });

  it.each([
    ['canonical persisted cross-currency snapshot', {
      amount: 18_250, paymentOriginalAmountMinor: 100,
      payment: { id: 'payment-1', tenantId: 'tenant-a', buildingId: 'building-a', unitId: 'unit-a', currency: 'USD', ...paymentSnapshot({ functionalAmountMinor: 18_250, functionalCurrencyCode: 'ARS', exchangeRateId: 'rate-1', exchangeRateValue: { toString: () => '182.5' }, exchangeRateDirection: 'DIRECT', exchangeRateEffectiveAt: new Date('2026-01-01'), conversionDate: new Date('2026-01-01') }) },
      charge: { id: 'charge-1', tenantId: 'tenant-a', buildingId: 'building-a', unitId: 'unit-a', currency: 'ARS' },
    }, { currencyCompatible: true, invariantValid: true }],
    ['legacy unresolved cross-currency allocation', {
      amount: 18_250, paymentOriginalAmountMinor: null,
      payment: { id: 'payment-2', tenantId: 'tenant-a', buildingId: 'building-a', unitId: 'unit-a', currency: 'USD', ...paymentSnapshot() },
      charge: { id: 'charge-2', tenantId: 'tenant-a', buildingId: 'building-a', unitId: 'unit-a', currency: 'ARS' },
    }, { currencyCompatible: true, invariantValid: true, representation: 'LEGACY_PAYMENT_ALLOCATION_CROSS' }],
    ['contradictory cross-currency snapshot', {
      amount: 18_250, paymentOriginalAmountMinor: 100,
      payment: { id: 'payment-3', tenantId: 'tenant-a', buildingId: 'building-a', unitId: 'unit-a', currency: 'USD', ...paymentSnapshot({ functionalAmountMinor: 18_250 }) },
      charge: { id: 'charge-3', tenantId: 'tenant-a', buildingId: 'building-a', unitId: 'unit-a', currency: 'ARS' },
    }, { currencyCompatible: false, invariantValid: false }],
  ])('maps %s without live FX', async (_name, row, expected) => {
    const adapter = createPrismaReadOnlyFinanceInventoryAdapter(emptyPrisma({
      paymentAllocation: { findMany: jest.fn().mockResolvedValue([{ id: 'allocation', tenantId: 'tenant-a', paymentId: row.payment.id, chargeId: row.charge.id, ...row }]) },
    }));
    const [record] = (await adapter.listPage('paymentAllocations', { limit: 1 })).records;
    expect(record).toMatchObject(expected);
    expect(classifyFinanceCondition({
      entity: 'paymentAllocations', counterpartPresent: true, sameTenant: true,
      currencyCompatible: record.currencyCompatible ?? false, currencyStatuses: record.currencyStatuses ?? [],
      invariantValid: record.invariantValid ?? true, representation: record.representation,
    }).classification).toBe(expected.invariantValid ? (expected.representation ? 'LEGACY_SUPPORTED' : 'SAFE') : 'INVALID_BLOCKING');
  });

  it.each([
      ['Charge -> Liquidation', 'charges', {
        charge: { findMany: jest.fn().mockResolvedValue([{ id: 'charge-1', tenantId: 'tenant-a', buildingId: 'building-a', currency: 'ARS', liquidationId: 'liquidation-1', building: { id: 'building-a', tenantId: 'tenant-a' }, unit: { tenantId: 'tenant-a', buildingId: 'building-a' }, liquidation: { tenantId: 'tenant-a', baseCurrency: 'ARS' } }]) },
      }, { present: true, tenantToken: 'tenant-a', currencyCode: 'ARS', currencyStatuses: ['CANONICAL_CURRENT'] }],
      ['PaymentAllocation -> Payment', 'paymentAllocations', {
        paymentAllocation: { findMany: jest.fn().mockResolvedValue([{ id: 'allocation-1', tenantId: 'tenant-a', paymentId: 'payment-1', chargeId: 'charge-1', amount: 100, paymentOriginalAmountMinor: null, payment: { id: 'payment-1', tenantId: 'tenant-a', buildingId: 'building-a', unitId: 'unit-a', currency: 'ARS', ...paymentSnapshot() }, charge: { id: 'charge-1', tenantId: 'tenant-a', buildingId: 'building-a', unitId: 'unit-a', currency: 'ARS' } }]) },
      }, { present: true, tenantToken: 'tenant-a', currencyCode: 'ARS', currencyStatuses: ['CANONICAL_CURRENT'] }],
      ['FundTransaction -> Fund', 'fundTransactions', {
        fundTransaction: { findMany: jest.fn().mockResolvedValue([{ id: 'transaction-1', tenantId: 'tenant-a', fundId: 'fund-1', direction: 'CREDIT', amountMinor: 100, currencyCode: 'ARS', fund: { tenantId: 'tenant-a' }, incomeApplication: null }]) },
      }, { present: true, tenantToken: 'tenant-a' }],
      ['IncomeApplication -> Income', 'incomeApplications', {
        incomeApplication: { findMany: jest.fn().mockResolvedValue([{ id: 'application-1', tenantId: 'tenant-a', incomeId: 'income-1', destinationType: 'OFFSET_EXPENSES', fundId: null, amountMinor: 100, currencyCode: 'ARS', income: { tenantId: 'tenant-a', currencyCode: 'ARS' }, fund: null, fundTransaction: null }]) },
      }, { present: true, tenantToken: 'tenant-a', currencyCode: 'ARS', currencyStatuses: ['CANONICAL_CURRENT'] }],
      ['MovementAllocation -> Expense', 'movementAllocations', {
        movementAllocation: { findMany: jest.fn().mockResolvedValue([{ id: 'movement-expense-1', tenantId: 'tenant-a', expenseId: 'expense-1', incomeId: null, currencyCode: 'ARS', building: { id: 'building-a', tenantId: 'tenant-a' }, expense: { tenantId: 'tenant-a', currencyCode: 'ARS' }, income: null }]) },
      }, { present: true, tenantToken: 'tenant-a', currencyCode: 'ARS', currencyStatuses: ['CANONICAL_CURRENT'] }],
      ['MovementAllocation -> Income', 'movementAllocations', {
        movementAllocation: { findMany: jest.fn().mockResolvedValue([{ id: 'movement-income-1', tenantId: 'tenant-a', expenseId: null, incomeId: 'income-1', currencyCode: 'ARS', building: { id: 'building-a', tenantId: 'tenant-a' }, expense: null, income: { tenantId: 'tenant-a', currencyCode: 'ARS' } }]) },
      }, { present: true, tenantToken: 'tenant-a', currencyCode: 'ARS', currencyStatuses: ['CANONICAL_CURRENT'] }],
      ['LiquidationIncomeOffset -> IncomeApplication', 'liquidationIncomeOffsets', {
        liquidationIncomeOffset: { findMany: jest.fn().mockResolvedValue([{ id: 'offset-1', tenantId: 'tenant-a', incomeApplicationId: 'application-1', buildingId: 'building-a', originalAmountMinor: 100, valuedAmountMinor: 100, currencyCode: 'ARS', baseCurrency: 'ARS', liquidation: { tenantId: 'tenant-a', buildingId: 'building-a', baseCurrency: 'ARS', valuationMode: 'LEGACY_NOMINAL' }, incomeApplication: { tenantId: 'tenant-a', amountMinor: 100, currencyCode: 'ARS' } }]) },
      }, { present: true, tenantToken: 'tenant-a', currencyCode: 'ARS', currencyStatuses: ['CANONICAL_CURRENT'] }],
    ])('maps %s counterpart evidence from selected Prisma relations', async (_name, entity: FinanceInventoryEntity, overrides, expected) => {
      const adapter = createPrismaReadOnlyFinanceInventoryAdapter(emptyPrisma(overrides));

      await expect(adapter.listPage(entity, { limit: 1 })).resolves.toMatchObject({
        records: [{ counterpartEvidence: expected }],
      });
    });

    it('maps FundTransaction/FUND and FUND IncomeApplication provenance', async () => {
    const adapter = createPrismaReadOnlyFinanceInventoryAdapter(emptyPrisma({
      fund: { findMany: jest.fn().mockResolvedValue([{ id: 'fund-1', tenantId: 'tenant-a', scopeType: 'BUILDING', building: { id: 'building-a', tenantId: 'tenant-a' } }]) },
      fundTransaction: { findMany: jest.fn().mockResolvedValue([{ id: 'transaction-1', tenantId: 'tenant-a', fundId: 'fund-1', direction: 'CREDIT', amountMinor: 500, currencyCode: 'ARS', fund: { id: 'fund-1', tenantId: 'tenant-a' }, incomeApplication: { tenantId: 'tenant-a', fundId: 'fund-1', destinationType: 'FUND', amountMinor: 500, currencyCode: 'ARS' } }]) },
      incomeApplication: { findMany: jest.fn().mockResolvedValue([{ id: 'application-1', tenantId: 'tenant-a', incomeId: 'income-1', destinationType: 'FUND', fundId: 'fund-1', amountMinor: 500, currencyCode: 'ARS', income: { id: 'income-1', tenantId: 'tenant-a', currencyCode: 'ARS' }, fund: { id: 'fund-1', tenantId: 'tenant-a' }, fundTransaction: { tenantId: 'tenant-a', fundId: 'fund-1', direction: 'CREDIT', amountMinor: 500, currencyCode: 'ARS' } }]) },
    }));
    await expect(adapter.listPage('funds', { limit: 1 })).resolves.toMatchObject({ records: [{ invariantValid: true }] });
    await expect(adapter.listPage('fundTransactions', { limit: 1 })).resolves.toMatchObject({ records: [{ invariantValid: true, counterpartEntity: 'funds' }] });
    await expect(adapter.listPage('incomeApplications', { limit: 1 })).resolves.toMatchObject({ records: [{ invariantValid: true }] });
  });

  it.each([
    ['canonical ARS', 'ARS', ['CANONICAL_CURRENT'], 'SAFE'],
    ['historical UYU', 'UYU', ['LEGACY_STORED'], 'LEGACY_SUPPORTED'],
    ['malformed historical code', 'US', ['MALFORMED'], 'REPAIRABLE'],
  ])('maps %s currency evidence through allocation counterparts', async (_name, currency, expectedStatuses, classification) => {
    const payment = { id: 'payment-1', tenantId: 'tenant-a', buildingId: 'building-a', unitId: 'unit-a', currency, ...paymentSnapshot() };
    const charge = { id: 'charge-1', tenantId: 'tenant-a', buildingId: 'building-a', unitId: 'unit-a', currency };
    const adapter = createPrismaReadOnlyFinanceInventoryAdapter(emptyPrisma({
      paymentAllocation: { findMany: jest.fn().mockResolvedValue([{ id: 'allocation-1', tenantId: 'tenant-a', paymentId: payment.id, chargeId: charge.id, amount: 100, paymentOriginalAmountMinor: null, payment, charge }]) },
    }));

    const [record] = (await adapter.listPage('paymentAllocations', { limit: 1 })).records;

    expect(record.currencyStatuses).toEqual(expectedStatuses);
    expect(record.counterpartEvidence?.currencyStatuses).toEqual(expectedStatuses);
    expect(classifyFinanceCondition({
      entity: 'paymentAllocations',
      counterpartPresent: true,
      sameTenant: true,
      currencyCompatible: record.currencyCompatible ?? false,
      currencyStatuses: [
        ...(record.currencyStatuses ?? []),
        ...(record.counterpartEvidence?.currencyStatuses ?? []),
      ],
      invariantValid: record.invariantValid ?? true,
      representation: record.representation,
    }).classification).toBe(classification);
  });

  it('derives legacy Income classifications using persisted status, destination, applications, and relevant liquidations', async () => {
    const income = { id: 'income-1', tenantId: 'tenant-a', period: '2026-01', scopeType: 'BUILDING', status: 'RECORDED', destination: 'APPLY_TO_EXPENSES', currencyCode: 'ARS', building: { id: 'building-a', tenantId: 'tenant-a' }, applications: [], allocations: [] };
    const liquidation = { findMany: jest.fn().mockResolvedValue([]) };
    const adapter = createPrismaReadOnlyFinanceInventoryAdapter(emptyPrisma({ income: { findMany: jest.fn().mockResolvedValue([income]) }, liquidation }));
    await expect(adapter.listPage('incomes', { limit: 1 })).resolves.toMatchObject({ records: [{ representation: 'LEGACY_INCOME', invariantValid: true }] });
    liquidation.findMany.mockResolvedValue([{ tenantId: 'tenant-a', period: '2026-01', buildingId: 'building-a' }]);
    await expect(adapter.listPage('incomes', { limit: 1 })).resolves.toMatchObject({ records: [{ representation: 'LEGACY_INCOME_LIQUIDATION_CONFLICT' }] });
  });

  it('batches legacy Income liquidation conflict lookups once per page', async () => {
    const incomes = [
      { id: 'income-1', tenantId: 'tenant-a', period: '2026-01', scopeType: 'BUILDING', status: 'RECORDED', destination: 'APPLY_TO_EXPENSES', currencyCode: 'ARS', building: { id: 'building-a', tenantId: 'tenant-a' }, applications: [], allocations: [] },
      { id: 'income-2', tenantId: 'tenant-a', period: '2026-01', scopeType: 'BUILDING', status: 'RECORDED', destination: 'APPLY_TO_EXPENSES', currencyCode: 'ARS', building: { id: 'building-b', tenantId: 'tenant-a' }, applications: [], allocations: [] },
    ];
    const liquidationFindMany = jest.fn().mockResolvedValue([
      { tenantId: 'tenant-a', period: '2026-01', buildingId: 'building-b' },
    ]);
    const adapter = createPrismaReadOnlyFinanceInventoryAdapter(emptyPrisma({
      income: { findMany: jest.fn().mockResolvedValue(incomes) },
      liquidation: { findMany: liquidationFindMany },
    }));

    const records = (await adapter.listPage('incomes', { limit: 2 })).records;

    expect(records.map((record) => record.representation)).toEqual([
      'LEGACY_INCOME',
      'LEGACY_INCOME_LIQUIDATION_CONFLICT',
    ]);
    expect(liquidationFindMany).toHaveBeenCalledTimes(1);
    expect(liquidationFindMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { tenantId: 'tenant-a', period: '2026-01', buildingId: 'building-a' },
          { tenantId: 'tenant-a', period: '2026-01', buildingId: 'building-b' },
        ],
        status: { in: ['DRAFT', 'REVIEWED', 'PUBLISHED'] },
      },
      select: { tenantId: true, period: true, buildingId: true },
    });
  });

  it('validates LiquidationIncomeOffset tenant, building, application, base-currency, and persisted valuation evidence', async () => {
    const adapter = createPrismaReadOnlyFinanceInventoryAdapter(emptyPrisma({
      liquidationIncomeOffset: { findMany: jest.fn().mockResolvedValue([{ id: 'offset-1', tenantId: 'tenant-a', incomeApplicationId: 'application-1', buildingId: 'building-a', originalAmountMinor: 100, valuedAmountMinor: 100, currencyCode: 'ARS', baseCurrency: 'ARS', liquidation: { tenantId: 'tenant-a', buildingId: 'building-a', baseCurrency: 'ARS', valuationMode: 'LEGACY_NOMINAL' }, incomeApplication: { id: 'application-1', tenantId: 'tenant-a', amountMinor: 100, currencyCode: 'ARS' } }]) },
    }));
    await expect(adapter.listPage('liquidationIncomeOffsets', { limit: 1 })).resolves.toMatchObject({ records: [{ invariantValid: true, counterpartEntity: 'incomeApplications' }] });
  });

  it('maps fixture-equivalent V1, V2, modern V3, and ZERO_NET liquidation shapes through the classifier', async () => {
    const base = { tenantId: 'tenant-a', baseCurrency: 'ARS', building: { id: 'building-a', tenantId: 'tenant-a' }, publicationIntegrityVersion: null };
    const rows = [
      { ...base, id: 'v1', publicationSnapshot: { version: 1 }, valuationMode: null, totalAmountMinor: 10, grossExpenseAmountMinor: null, adjustmentAmountMinor: null, preIncomeAmountMinor: null, incomeOffsetAmountMinor: null, netDistributableAmountMinor: null },
      { ...base, id: 'v2', publicationSnapshot: { version: 2 }, valuationMode: 'FUNCTIONAL', totalAmountMinor: 10, grossExpenseAmountMinor: null, adjustmentAmountMinor: null, preIncomeAmountMinor: null, incomeOffsetAmountMinor: null, netDistributableAmountMinor: null },
      { ...base, id: 'v3', publicationSnapshot: { version: 3 }, valuationMode: 'FUNCTIONAL', totalAmountMinor: 100, grossExpenseAmountMinor: 100, adjustmentAmountMinor: 0, preIncomeAmountMinor: 100, incomeOffsetAmountMinor: 0, netDistributableAmountMinor: 100 },
      { ...base, id: 'zero', publicationSnapshot: { version: 3 }, valuationMode: 'FUNCTIONAL', totalAmountMinor: 0, grossExpenseAmountMinor: 100, adjustmentAmountMinor: 0, preIncomeAmountMinor: 100, incomeOffsetAmountMinor: 100, netDistributableAmountMinor: 0 },
    ];
    const adapter = createPrismaReadOnlyFinanceInventoryAdapter(emptyPrisma({ liquidation: { findMany: jest.fn().mockResolvedValue(rows) } }));
    const records = (await adapter.listPage('liquidations', { limit: 4 })).records;
    expect(records.map((record) => record.representation)).toEqual(['V1', 'V2', 'V3', 'ZERO_NET']);
    expect(records.map((record) => classifyFinanceCondition({ entity: 'liquidations', counterpartPresent: true, sameTenant: true, currencyCompatible: true, currencyStatuses: record.currencyStatuses ?? [], invariantValid: record.invariantValid ?? true, representation: record.representation }).classification)).toEqual(['LEGACY_SUPPORTED', 'LEGACY_SUPPORTED', 'SAFE', 'SAFE']);
  });
});
