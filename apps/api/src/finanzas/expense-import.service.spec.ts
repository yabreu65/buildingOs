import { ExpenseImportService } from './expense-import.service';

describe('ExpenseImportService', () => {
  const tenantId = 'tenant-1';
  const buildingId = 'building-1';
  const userId = 'user-1';
  const validRow = {
    fecha: '10/08/2026',
    descripcion: 'Municipal tax',
    monto: 12.34,
    moneda: 'ars',
    edificio: 'Tower A',
    categoria: 'Taxes',
  };

  let prisma: {
    building: { findFirst: jest.Mock };
    expenseLedgerCategory: { findFirst: jest.Mock };
    liquidation: { findFirst: jest.Mock };
    vendor: { findFirst: jest.Mock; create: jest.Mock };
    expense: { create: jest.Mock };
  };
  let auditService: { createLog: jest.Mock };
  let service: ExpenseImportService;

  beforeEach(() => {
    prisma = {
      building: { findFirst: jest.fn().mockResolvedValue({ id: buildingId, tenantId }) },
      expenseLedgerCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: 'category-1', name: 'Taxes' }),
      },
      liquidation: { findFirst: jest.fn().mockResolvedValue(null) },
      vendor: { findFirst: jest.fn(), create: jest.fn() },
      expense: { create: jest.fn().mockResolvedValue({ id: 'expense-1' }) },
    };
    auditService = { createLog: jest.fn() };
    service = new ExpenseImportService(prisma as never, auditService as never);
  });

  it('creates canonical BUILDING DRAFT rows with exact cents', async () => {
    const result = await service.importExpensesFromRows(
      tenantId,
      buildingId,
      '2026-08',
      [validRow],
      userId,
    );

    expect(result).toMatchObject({ successCount: 1, failureCount: 0, createdExpenses: ['expense-1'] });
    expect(prisma.expenseLedgerCategory.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId,
        name: 'Taxes',
        movementType: 'EXPENSE',
        isActive: true,
        catalogScope: 'BUILDING',
      },
    });
    expect(prisma.expense.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId,
        buildingId,
        period: '2026-08',
        liquidationPeriod: '2026-08',
        amountMinor: 1234,
        currencyCode: 'ARS',
        scopeType: 'BUILDING',
        status: 'DRAFT',
        invoiceDate: new Date('2026-08-10T00:00:00.000Z'),
      }),
    });
  });

  it.each([
    ['a request-period mismatch', { fecha: '10/09/2026' }],
    ['a TENANT_SHARED alias', { edificio: 'tenant_shared' }],
    ['a non-canonical currency', { moneda: 'XYZ' }],
    ['a non-exact amount', { monto: 12.345 }],
    ['a non-finite amount', { monto: Number.POSITIVE_INFINITY }],
  ])('keeps the invalid row out of writes for %s', async (_reason, invalid) => {
    const result = await service.importExpensesFromRows(
      tenantId,
      buildingId,
      '2026-08',
      [{ ...validRow, ...invalid }],
      userId,
    );

    expect(result).toMatchObject({ totalRows: 1, successCount: 0, failureCount: 1 });
    expect(result.errors).toHaveLength(1);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  it('rejects rows when the building invoice period is already published', async () => {
    prisma.liquidation.findFirst.mockResolvedValue({ id: 'liq-1' });

    const result = await service.importExpensesFromRows(
      tenantId,
      buildingId,
      '2026-08',
      [validRow],
      userId,
    );

    expect(result).toMatchObject({ successCount: 0, failureCount: 1 });
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  it('preserves row-level accounting when one row fails validation', async () => {
    const result = await service.importExpensesFromRows(
      tenantId,
      buildingId,
      '2026-08',
      [validRow, { ...validRow, monto: 1.001 }],
      userId,
    );

    expect(result).toMatchObject({ totalRows: 2, successCount: 1, failureCount: 1 });
    expect(result.errors).toEqual([
      expect.objectContaining({ rowIndex: 1 }),
    ]);
    expect(prisma.expense.create).toHaveBeenCalledTimes(1);
  });
});
