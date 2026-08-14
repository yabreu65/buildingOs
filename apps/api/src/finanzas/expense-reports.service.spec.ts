import { ExpenseReportsService } from './expense-reports.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { FinanzasValidators } from './finanzas.validators';

function makeService(prisma: unknown): ExpenseReportsService {
  const validators = {
    isAdminOrOperator: () => true,
  } as unknown as FinanzasValidators;
  return new ExpenseReportsService(prisma as PrismaService, validators);
}

function makeHistoryPrisma(
  buildingRows: unknown[],
  sharedExpenses: unknown[],
  buildings: unknown[],
) {
  return {
    expense: {
      groupBy: async () => buildingRows,
      findMany: async () => sharedExpenses,
    },
    building: { findMany: async () => buildings },
  };
}

function expenseRow(o: {
  period: string;
  buildingId?: string | null;
  currencyCode: string;
  amountMinor: number;
  allocations?: Array<{ buildingId: string | null; amountMinor: number | null; percentage: number | null }>;
}) {
  return {
    period: o.period,
    buildingId: o.buildingId ?? null,
    currencyCode: o.currencyCode,
    amountMinor: o.amountMinor,
    allocations: o.allocations ?? [],
  };
}

describe('ExpenseReportsService.getExpenseHistory (3F6 buckets)', () => {
  it('single USD -> only USD bucket', async () => {
    const svc = makeService(
      makeHistoryPrisma(
        [{ period: '2026-07', buildingId: 'b-1', currencyCode: 'USD', _sum: { amountMinor: 10000 } }],
        [],
        [{ id: 'b-1', name: 'B1' }],
      ),
    );

    const [report] = await svc.getExpenseHistory('t-1', ['TENANT_ADMIN']);

    expect(report.byBuilding[0]!.buildingExpensesByCurrency).toEqual([
      { currency: 'USD', amountMinor: 10000 },
    ]);
    expect(report.totalTenantByCurrency).toEqual([{ currency: 'USD', amountMinor: 10000 }]);
  });

  it('single ARS -> only ARS bucket', async () => {
    const svc = makeService(
      makeHistoryPrisma(
        [{ period: '2026-07', buildingId: 'b-1', currencyCode: 'ARS', _sum: { amountMinor: 2000000 } }],
        [],
        [{ id: 'b-1', name: 'B1' }],
      ),
    );

    const [report] = await svc.getExpenseHistory('t-1', ['TENANT_ADMIN']);

    expect(report.byBuilding[0]!.buildingExpensesByCurrency).toEqual([
      { currency: 'ARS', amountMinor: 2000000 },
    ]);
  });

  it('single COP -> COP bucket ONLY, never labelled ARS', async () => {
    const svc = makeService(
      makeHistoryPrisma(
        [{ period: '2026-07', buildingId: 'b-1', currencyCode: 'COP', _sum: { amountMinor: 5000000 } }],
        [],
        [{ id: 'b-1', name: 'B1' }],
      ),
    );

    const [report] = await svc.getExpenseHistory('t-1', ['TENANT_ADMIN']);

    expect(report.byBuilding[0]!.buildingExpensesByCurrency).toEqual([
      { currency: 'COP', amountMinor: 5000000 },
    ]);
    // No ARS bucket is invented for COP data.
    expect(report.byBuilding[0]!.buildingExpensesByCurrency).not.toContainEqual(
      expect.objectContaining({ currency: 'ARS' }),
    );
  });

  it('COP regression: COP and ARS stay in separate buckets', async () => {
    const svc = makeService(
      makeHistoryPrisma(
        [
          { period: '2026-07', buildingId: 'b-1', currencyCode: 'COP', _sum: { amountMinor: 5000000 } },
          { period: '2026-07', buildingId: 'b-1', currencyCode: 'ARS', _sum: { amountMinor: 2000000 } },
        ],
        [],
        [{ id: 'b-1', name: 'B1' }],
      ),
    );

    const [report] = await svc.getExpenseHistory('t-1', ['TENANT_ADMIN']);

    expect(report.byBuilding[0]!.buildingExpensesByCurrency).toEqual([
      { currency: 'ARS', amountMinor: 2000000 },
      { currency: 'COP', amountMinor: 5000000 },
    ]);
  });

  it('multi USD+VES+ARS+COP -> four separate buckets in canonical order', async () => {
    const svc = makeService(
      makeHistoryPrisma(
        [
          { period: '2026-07', buildingId: 'b-1', currencyCode: 'ARS', _sum: { amountMinor: 100 } },
          { period: '2026-07', buildingId: 'b-1', currencyCode: 'COP', _sum: { amountMinor: 400 } },
          { period: '2026-07', buildingId: 'b-1', currencyCode: 'USD', _sum: { amountMinor: 200 } },
          { period: '2026-07', buildingId: 'b-1', currencyCode: 'VES', _sum: { amountMinor: 300 } },
        ],
        [],
        [{ id: 'b-1', name: 'B1' }],
      ),
    );

    const [report] = await svc.getExpenseHistory('t-1', ['TENANT_ADMIN']);

    expect(report.byBuilding[0]!.buildingExpensesByCurrency.map((b) => b.currency)).toEqual([
      'USD',
      'VES',
      'ARS',
      'COP',
    ]);
  });

  it('same-currency aggregation: multiple ARS expenses sum only within ARS', async () => {
    const svc = makeService(
      makeHistoryPrisma(
        [
          { period: '2026-07', buildingId: 'b-1', currencyCode: 'ARS', _sum: { amountMinor: 10000 } },
          { period: '2026-07', buildingId: 'b-1', currencyCode: 'ARS', _sum: { amountMinor: 20000 } },
          { period: '2026-07', buildingId: 'b-1', currencyCode: 'USD', _sum: { amountMinor: 5000 } },
        ],
        [],
        [{ id: 'b-1', name: 'B1' }],
      ),
    );

    const [report] = await svc.getExpenseHistory('t-1', ['TENANT_ADMIN']);

    expect(report.byBuilding[0]!.buildingExpensesByCurrency).toEqual([
      { currency: 'USD', amountMinor: 5000 },
      { currency: 'ARS', amountMinor: 30000 },
    ]);
  });

  it('legacy UYU -> independent UYU bucket (no ARS fallback)', async () => {
    const svc = makeService(
      makeHistoryPrisma(
        [{ period: '2026-07', buildingId: 'b-1', currencyCode: 'UYU', _sum: { amountMinor: 500000 } }],
        [],
        [{ id: 'b-1', name: 'B1' }],
      ),
    );

    const [report] = await svc.getExpenseHistory('t-1', ['TENANT_ADMIN']);

    expect(report.byBuilding[0]!.buildingExpensesByCurrency).toEqual([
      { currency: 'UYU', amountMinor: 500000 },
    ]);
  });

  it('canonical first, legacy lexicographic after', async () => {
    const svc = makeService(
      makeHistoryPrisma(
        [
          { period: '2026-07', buildingId: 'b-1', currencyCode: 'UYU', _sum: { amountMinor: 100 } },
          { period: '2026-07', buildingId: 'b-1', currencyCode: 'BRL', _sum: { amountMinor: 200 } },
          { period: '2026-07', buildingId: 'b-1', currencyCode: 'COP', _sum: { amountMinor: 300 } },
          { period: '2026-07', buildingId: 'b-1', currencyCode: 'USD', _sum: { amountMinor: 400 } },
        ],
        [],
        [{ id: 'b-1', name: 'B1' }],
      ),
    );

    const [report] = await svc.getExpenseHistory('t-1', ['TENANT_ADMIN']);

    expect(report.byBuilding[0]!.buildingExpensesByCurrency.map((b) => b.currency)).toEqual([
      'USD',
      'COP',
      'BRL',
      'UYU',
    ]);
  });

  it('tenant isolation: expenses from another tenant never enter', async () => {
    // groupBy where clause is tenant-scoped; the mock returns only t-1 rows.
    const groupBy = jest.fn().mockResolvedValue([
      { period: '2026-07', buildingId: 'b-1', currencyCode: 'USD', _sum: { amountMinor: 10000 } },
    ]);
    const svc = makeService({
      expense: { groupBy, findMany: async () => [] },
      building: { findMany: async () => [{ id: 'b-1', name: 'B1' }] },
    });

    const [report] = await svc.getExpenseHistory('t-1', ['TENANT_ADMIN']);

    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 't-1' }),
      }),
    );
    expect(report.totalTenantByCurrency).toEqual([{ currency: 'USD', amountMinor: 10000 }]);
  });

  it('building scope: each building only sees its own expenses', async () => {
    const svc = makeService(
      makeHistoryPrisma(
        [
          { period: '2026-07', buildingId: 'b-1', currencyCode: 'ARS', _sum: { amountMinor: 10000 } },
          { period: '2026-07', buildingId: 'b-2', currencyCode: 'ARS', _sum: { amountMinor: 90000 } },
        ],
        [],
        [
          { id: 'b-1', name: 'B1' },
          { id: 'b-2', name: 'B2' },
        ],
      ),
    );

    const [report] = await svc.getExpenseHistory('t-1', ['TENANT_ADMIN']);

    const b1 = report.byBuilding.find((b) => b.buildingId === 'b-1')!;
    const b2 = report.byBuilding.find((b) => b.buildingId === 'b-2')!;
    expect(b1.buildingExpensesByCurrency).toEqual([{ currency: 'ARS', amountMinor: 10000 }]);
    expect(b2.buildingExpensesByCurrency).toEqual([{ currency: 'ARS', amountMinor: 90000 }]);
    expect(report.totalTenantByCurrency).toEqual([{ currency: 'ARS', amountMinor: 100000 }]);
  });

  it('amount scale: minor units preserved (10000 = 100.00)', async () => {
    const svc = makeService(
      makeHistoryPrisma(
        [{ period: '2026-07', buildingId: 'b-1', currencyCode: 'USD', _sum: { amountMinor: 12345 } }],
        [],
        [{ id: 'b-1', name: 'B1' }],
      ),
    );

    const [report] = await svc.getExpenseHistory('t-1', ['TENANT_ADMIN']);

    expect(report.byBuilding[0]!.buildingExpensesByCurrency[0]!.amountMinor).toBe(12345);
  });

  it('shared expenses produce per-currency buckets and totals', async () => {
    const svc = makeService(
      makeHistoryPrisma(
        [],
        [
          expenseRow({
            period: '2026-07',
            currencyCode: 'USD',
            amountMinor: 10000,
            allocations: [{ buildingId: 'b-1', amountMinor: 5000, percentage: null }],
          }),
          expenseRow({
            period: '2026-07',
            currencyCode: 'ARS',
            amountMinor: 20000,
            allocations: [{ buildingId: 'b-1', amountMinor: 20000, percentage: null }],
          }),
        ],
        [{ id: 'b-1', name: 'B1' }],
      ),
    );

    const [report] = await svc.getExpenseHistory('t-1', ['TENANT_ADMIN']);

    expect(report.sharedTotalByCurrency).toEqual([
      { currency: 'USD', amountMinor: 10000 },
      { currency: 'ARS', amountMinor: 20000 },
    ]);
    expect(report.byBuilding[0]!.sharedPortionByCurrency).toEqual([
      { currency: 'USD', amountMinor: 5000 },
      { currency: 'ARS', amountMinor: 20000 },
    ]);
    // No mixed scalar total anywhere.
    expect(report).not.toHaveProperty('totalTenant');
    expect(report).not.toHaveProperty('sharedTotal');
  });

  it('empty period -> empty buckets, no invented currencies', async () => {
    const svc = makeService(makeHistoryPrisma([], [], [{ id: 'b-1', name: 'B1' }]));

    const reports = await svc.getExpenseHistory('t-1', ['TENANT_ADMIN']);

    expect(reports).toEqual([]);
  });
});

describe('ExpenseReportsService.getNotasRevelatorias (3F6 line items)', () => {
  function makeNotasPrisma(commonExps: unknown[]) {
    return {
      tenant: { findUnique: async () => ({ name: 'T1' }) },
      building: { findMany: async () => [{ id: 'b-1', name: 'B1' }] },
      income: { findMany: async () => [] },
      expense: {
        findMany: async (args: { where: { scopeType: string } }) =>
          args.where.scopeType === 'TENANT_SHARED' ? commonExps : [],
      },
      unitCategory: { findMany: async () => [] },
      liquidation: { findMany: async () => [] },
      adjustment: { findMany: async () => [] },
    };
  }

  function notaExpense(o: { currencyCode: string; amountMinor: number; invoiceDate?: Date }) {
    return {
      id: 'e-1',
      currencyCode: o.currencyCode,
      amountMinor: o.amountMinor,
      description: 'Exp',
      invoiceDate: o.invoiceDate ?? new Date('2026-07-02T00:00:00Z'),
    };
  }

  it('COP line item keeps its own currency (never becomes pesos/ARS)', async () => {
    const svc = makeService(
      makeNotasPrisma([
        notaExpense({ currencyCode: 'COP', amountMinor: 5000000 }),
        notaExpense({ currencyCode: 'USD', amountMinor: 10000 }),
        notaExpense({ currencyCode: 'ARS', amountMinor: 2000000 }),
        notaExpense({ currencyCode: 'UYU', amountMinor: 500000 }),
      ]),
    );

    const report = await svc.getNotasRevelatorias('t-1', '2026-07', ['TENANT_ADMIN']);

    const amounts = report.commonExpenses.map((i) => i.amountByCurrency);
    expect(amounts).toEqual([
      [{ currency: 'COP', amountMinor: 5000000 }],
      [{ currency: 'USD', amountMinor: 10000 }],
      [{ currency: 'ARS', amountMinor: 2000000 }],
      [{ currency: 'UYU', amountMinor: 500000 }],
    ]);
    expect(report.commonTotals.byCurrency.map((b) => b.currency)).toEqual([
      'USD',
      'ARS',
      'COP',
      'UYU',
    ]);
  });

  it('alícuota section is explicitly labelled USD (deliberate single-currency contract)', async () => {
    const svc = makeService(
      makeNotasPrisma([
        notaExpense({ currencyCode: 'USD', amountMinor: 10000 }),
        notaExpense({ currencyCode: 'ARS', amountMinor: 2000000 }),
      ]),
    );

    const report = await svc.getNotasRevelatorias('t-1', '2026-07', ['TENANT_ADMIN']);

    for (const alicuota of report.alicuotas) {
      expect(alicuota.baseCurrency).toBe('USD');
    }
  });
});
