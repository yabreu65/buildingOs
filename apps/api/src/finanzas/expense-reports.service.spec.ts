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
  function makeNotasPrisma(
    commonExps: unknown[],
    options: {
      buildings?: unknown[];
      buildingExps?: unknown[];
      unitCategories?: unknown[];
    } = {},
  ) {
    const expenseFindMany = jest.fn().mockImplementation(
      async (args: { where: { scopeType: string } }) =>
        args.where.scopeType === 'TENANT_SHARED' ? commonExps : (options.buildingExps ?? []),
    );
    return {
      tenant: { findUnique: async () => ({ name: 'T1' }) },
      building: { findMany: async () => options.buildings ?? [{ id: 'b-1', name: 'B1' }] },
      income: { findMany: async () => [] },
      expense: { findMany: expenseFindMany },
      unitCategory: { findMany: async () => options.unitCategories ?? [] },
      liquidation: { findMany: async () => [] },
      adjustment: { findMany: async () => [] },
    };
  }

  function notaExpense(o: {
    currencyCode: string;
    amountMinor: number;
    invoiceDate?: Date;
    buildingId?: string;
    allocations?: Array<{ buildingId: string | null; amountMinor: number | null; percentage: number | null }>;
  }) {
    return {
      id: 'e-1',
      currencyCode: o.currencyCode,
      amountMinor: o.amountMinor,
      description: 'Exp',
      invoiceDate: o.invoiceDate ?? new Date('2026-07-02T00:00:00Z'),
      buildingId: o.buildingId ?? null,
      allocations: o.allocations ?? [],
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

  it('reconstructs a 50/50 all-null allocation exactly with a first-entry remainder', async () => {
    const svc = makeService(makeNotasPrisma(
      [
        notaExpense({
          currencyCode: 'VES',
          amountMinor: 10001,
          allocations: [
            { buildingId: 'b-1', amountMinor: null, percentage: 50 },
            { buildingId: 'b-2', amountMinor: null, percentage: 50 },
          ],
        }),
        notaExpense({
          currencyCode: 'USD',
          amountMinor: 10001,
          allocations: [
            { buildingId: 'b-1', amountMinor: null, percentage: 50 },
            { buildingId: 'b-2', amountMinor: null, percentage: 50 },
          ],
        }),
      ],
      {
        buildings: [
          { id: 'b-1', name: 'B1' },
          { id: 'b-2', name: 'B2' },
          { id: 'b-3', name: 'B3' },
        ],
        buildingExps: [notaExpense({ currencyCode: 'VES', amountMinor: 9, buildingId: 'b-1' })],
        unitCategories: [
          { buildingId: 'b-1', name: 'B1 category', coefficient: 100, units: [{ id: 'u-1', buildingId: 'b-1' }] },
          { buildingId: 'b-2', name: 'B2 category', coefficient: 100, units: [{ id: 'u-2', buildingId: 'b-2' }] },
        ],
      },
    ));

    const report = await svc.getNotasRevelatorias('t-1', '2026-07', ['TENANT_ADMIN']);
    const b1 = report.alicuotas.find((alicuota) => alicuota.buildingId === 'b-1')!;
    const b2 = report.alicuotas.find((alicuota) => alicuota.buildingId === 'b-2')!;

    expect(b1.rows[0]!.gastosComunesPerUnit).toBe(5001);
    expect(b2.rows[0]!.gastosComunesPerUnit).toBe(5000);
    expect(b1.rows[0]!.gastosComunesPerUnit + b2.rows[0]!.gastosComunesPerUnit).toBe(10001);
    expect(report.reservaLegal).toEqual([
      { buildingName: 'B1', byCurrency: [{ currency: 'VES', amountMinor: 501 }] },
      { buildingName: 'B2', byCurrency: [{ currency: 'VES', amountMinor: 500 }] },
      { buildingName: 'B3', byCurrency: [] },
    ]);
  });

  it('reconstructs three-way fractional percentages with an exact total', async () => {
    const svc = makeService(makeNotasPrisma(
      [notaExpense({
        currencyCode: 'USD',
        amountMinor: 10001,
        allocations: [
          { buildingId: 'b-1', amountMinor: null, percentage: 33.33 },
          { buildingId: 'b-2', amountMinor: null, percentage: 33.33 },
          { buildingId: 'b-3', amountMinor: null, percentage: 33.34 },
        ],
      })],
      {
        buildings: [
          { id: 'b-1', name: 'B1' },
          { id: 'b-2', name: 'B2' },
          { id: 'b-3', name: 'B3' },
        ],
        unitCategories: [
          { buildingId: 'b-1', name: 'B1 category', coefficient: 100, units: [{ id: 'u-1', buildingId: 'b-1' }] },
          { buildingId: 'b-2', name: 'B2 category', coefficient: 100, units: [{ id: 'u-2', buildingId: 'b-2' }] },
          { buildingId: 'b-3', name: 'B3 category', coefficient: 100, units: [{ id: 'u-3', buildingId: 'b-3' }] },
        ],
      },
    ));

    const report = await svc.getNotasRevelatorias('t-1', '2026-07', ['TENANT_ADMIN']);
    const shares = report.alicuotas.map((alicuota) => alicuota.rows[0]!.gastosComunesPerUnit);

    expect(shares).toEqual([3333, 3333, 3335]);
    expect(shares.reduce((sum, amount) => sum + amount, 0)).toBe(10001);
  });

  it('keeps persisted allocations authoritative and reconstructs only the null remainder', async () => {
    const svc = makeService(makeNotasPrisma(
      [notaExpense({
        currencyCode: 'USD',
        amountMinor: 10001,
        allocations: [
          { buildingId: 'b-1', amountMinor: 7000, percentage: 70 },
          { buildingId: 'b-2', amountMinor: null, percentage: 10 },
          { buildingId: 'b-3', amountMinor: null, percentage: 20 },
        ],
      })],
      {
        buildings: [
          { id: 'b-1', name: 'B1' },
          { id: 'b-2', name: 'B2' },
          { id: 'b-3', name: 'B3' },
        ],
        unitCategories: [
          { buildingId: 'b-1', name: 'B1 category', coefficient: 100, units: [{ id: 'u-1', buildingId: 'b-1' }] },
          { buildingId: 'b-2', name: 'B2 category', coefficient: 100, units: [{ id: 'u-2', buildingId: 'b-2' }] },
          { buildingId: 'b-3', name: 'B3 category', coefficient: 100, units: [{ id: 'u-3', buildingId: 'b-3' }] },
        ],
      },
    ));

    const report = await svc.getNotasRevelatorias('t-1', '2026-07', ['TENANT_ADMIN']);
    const shares = report.alicuotas.map((alicuota) => alicuota.rows[0]!.gastosComunesPerUnit);

    expect(shares).toEqual([7000, 1000, 2001]);
    expect(shares.reduce((sum, amount) => sum + amount, 0)).toBe(10001);
  });

  it('uses persisted unequal shared VES and USD allocations per building, independent of building count', async () => {
    const svc = makeService(makeNotasPrisma(
      [
        notaExpense({ currencyCode: 'VES', amountMinor: 5000, allocations: [{ buildingId: 'b-1', amountMinor: 3500, percentage: null }, { buildingId: 'b-2', amountMinor: 1500, percentage: null }] }),
        notaExpense({ currencyCode: 'VES', amountMinor: 5000, allocations: [{ buildingId: 'b-1', amountMinor: 3500, percentage: null }, { buildingId: 'b-2', amountMinor: 1500, percentage: null }] }),
        notaExpense({ currencyCode: 'USD', amountMinor: 10000, allocations: [{ buildingId: 'b-1', amountMinor: 7000, percentage: null }, { buildingId: 'b-2', amountMinor: 3000, percentage: null }] }),
        notaExpense({ currencyCode: 'ARS', amountMinor: 20000, allocations: [{ buildingId: 'b-1', amountMinor: 20000, percentage: null }], }),
      ],
      {
        buildings: [{ id: 'b-1', name: 'B1' }, { id: 'b-2', name: 'B2' }, { id: 'b-3', name: 'B3' }],
        buildingExps: [notaExpense({ currencyCode: 'VES', amountMinor: 1000, buildingId: 'b-1' })],
        unitCategories: [
          { buildingId: 'b-1', name: 'B1 category', coefficient: 100, units: [{ id: 'u-1', buildingId: 'b-1' }] },
          { buildingId: 'b-2', name: 'B2 category', coefficient: 100, units: [{ id: 'u-2', buildingId: 'b-2' }] },
        ],
      },
    ));

    const report = await svc.getNotasRevelatorias('t-1', '2026-07', ['TENANT_ADMIN']);

    expect(report.reservaLegal).toEqual([
      { buildingName: 'B1', byCurrency: [{ currency: 'VES', amountMinor: 800 }] },
      { buildingName: 'B2', byCurrency: [{ currency: 'VES', amountMinor: 300 }] },
      { buildingName: 'B3', byCurrency: [] },
    ]);
    expect(report.alicuotas.find((a) => a.buildingId === 'b-1')!.rows[0]!.gastosComunesPerUnit).toBe(7000);
    expect(report.alicuotas.find((a) => a.buildingId === 'b-2')!.rows[0]!.gastosComunesPerUnit).toBe(3000);
  });

  it('preserves known partial percentage shares when an all-null legacy set is incomplete', async () => {
    const svc = makeService(makeNotasPrisma(
      [notaExpense({
        currencyCode: 'VES',
        amountMinor: 10000,
        allocations: [{ buildingId: 'b-1', amountMinor: null, percentage: 25 }],
      })],
    ));

    const report = await svc.getNotasRevelatorias('t-1', '2026-07', ['TENANT_ADMIN']);

    expect(report.reservaLegal).toEqual([
      { buildingName: 'B1', byCurrency: [{ currency: 'VES', amountMinor: 250 }] },
    ]);
  });

  it('loads tenant-scoped shared allocations for the requested period', async () => {
    const prisma = makeNotasPrisma([]);
    const svc = makeService(prisma);

    await svc.getNotasRevelatorias('t-1', '2026-07', ['TENANT_ADMIN']);

    expect(prisma.expense.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't-1', period: '2026-07', scopeType: 'TENANT_SHARED', status: 'VALIDATED' },
      include: {
        allocations: {
          where: { tenantId: 't-1' },
          orderBy: { buildingId: 'asc' },
          select: { buildingId: true, amountMinor: true, percentage: true },
        },
      },
      orderBy: { invoiceDate: 'asc' },
    });
  });
});
