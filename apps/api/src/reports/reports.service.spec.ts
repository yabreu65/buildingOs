import { PaymentStatus } from '@prisma/client';
import { ReportsService } from './reports.service';
import type { PrismaService } from '../prisma/prisma.service';

const APPROVED = PaymentStatus.APPROVED;
const RECONCILED = PaymentStatus.RECONCILED;
const SUBMITTED = PaymentStatus.SUBMITTED;
const REJECTED = PaymentStatus.REJECTED;

interface ChargeFixture {
  id?: string;
  unitId?: string;
  amount: number;
  currency?: string;
  dueDate?: Date;
  canceledAt?: Date | null;
  buildingId?: string;
  period?: string;
  allocations?: Array<{ amount: number; payment?: { status?: string | null } | null }>;
}

function charge({
  id = 'chg-1',
  unitId = 'unit-1',
  amount,
  currency = 'ARS',
  dueDate = new Date('2024-01-15T00:00:00Z'),
  canceledAt = null,
  buildingId = 'building-1',
  period = '2024-01',
  allocations = [],
}: ChargeFixture) {
  return {
    id,
    unitId,
    amount,
    currency,
    dueDate,
    canceledAt,
    buildingId,
    period,
    paymentAllocations: allocations,
  };
}

describe('ReportsService.getFinanceReport', () => {
  let service: ReportsService;
  let findMany: jest.Mock;

  function mockCharges(charges: unknown[]) {
    findMany.mockResolvedValue(charges);
  }

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    const prisma = { charge: { findMany } } as unknown as PrismaService;
    service = new ReportsService(prisma);
  });

  it('A: single currency aggregates charges, paid and outstanding', async () => {
    mockCharges([
      charge({ amount: 10000, allocations: [{ amount: 4000, payment: { status: APPROVED } }] }),
      charge({ id: 'chg-2', unitId: 'unit-2', amount: 20000 }),
    ]);

    const report = await service.getFinanceReport('tenant-1', {});

    expect(report.totalChargesByCurrency).toEqual([{ currency: 'ARS', amountMinor: 30000 }]);
    expect(report.totalPaidByCurrency).toEqual([{ currency: 'ARS', amountMinor: 4000 }]);
    expect(report.totalOutstandingByCurrency).toEqual([{ currency: 'ARS', amountMinor: 26000 }]);
    expect(report.collectionRateByCurrency).toEqual([{ currency: 'ARS', rate: 13 }]);
  });

  it('B: multi-currency buckets follow canonical order USD, VES, ARS, COP', async () => {
    mockCharges([
      charge({ amount: 2000, currency: 'ARS' }),
      charge({ id: 'chg-2', unitId: 'unit-2', amount: 10000, currency: 'USD' }),
      charge({ id: 'chg-3', unitId: 'unit-3', amount: 5000, currency: 'VES' }),
    ]);

    const report = await service.getFinanceReport('tenant-1', {});

    expect(report.totalChargesByCurrency).toEqual([
      { currency: 'USD', amountMinor: 10000 },
      { currency: 'VES', amountMinor: 5000 },
      { currency: 'ARS', amountMinor: 2000 },
    ]);
    expect(report.totalPaidByCurrency).toEqual([
      { currency: 'USD', amountMinor: 0 },
      { currency: 'VES', amountMinor: 0 },
      { currency: 'ARS', amountMinor: 0 },
    ]);
    expect(report.totalOutstandingByCurrency).toEqual([
      { currency: 'USD', amountMinor: 10000 },
      { currency: 'VES', amountMinor: 5000 },
      { currency: 'ARS', amountMinor: 2000 },
    ]);
  });

  it('C: CROSS-currency unit keeps per-currency outstanding buckets', async () => {
    mockCharges([
      charge({ unitId: 'unit-1', amount: 10000, currency: 'USD' }),
      charge({
        id: 'chg-2',
        unitId: 'unit-1',
        amount: 5000,
        currency: 'VES',
        allocations: [{ amount: 2000, payment: { status: APPROVED } }],
      }),
    ]);

    const report = await service.getFinanceReport('tenant-1', {});

    expect(report.delinquentUnitsCount).toBe(1);
    expect(report.delinquentUnits[0]).toEqual({
      unitId: 'unit-1',
      outstandingByCurrency: [
        { currency: 'USD', amountMinor: 10000 },
        { currency: 'VES', amountMinor: 3000 },
      ],
    });
  });

  it('D: SUBMITTED allocations never reduce outstanding nor count as paid', async () => {
    mockCharges([
      charge({ amount: 10000, allocations: [{ amount: 7000, payment: { status: SUBMITTED } }] }),
    ]);

    const report = await service.getFinanceReport('tenant-1', {});

    expect(report.totalPaidByCurrency).toEqual([{ currency: 'ARS', amountMinor: 0 }]);
    expect(report.totalOutstandingByCurrency).toEqual([{ currency: 'ARS', amountMinor: 10000 }]);
  });

  it('E: RECONCILED allocations count as paid (accounting-effective)', async () => {
    mockCharges([
      charge({ amount: 10000, allocations: [{ amount: 10000, payment: { status: RECONCILED } }] }),
    ]);

    const report = await service.getFinanceReport('tenant-1', {});

    expect(report.totalPaidByCurrency).toEqual([{ currency: 'ARS', amountMinor: 10000 }]);
    expect(report.totalOutstandingByCurrency).toEqual([{ currency: 'ARS', amountMinor: 0 }]);
  });

  it('F: over-allocation is bounded — paid never exceeds charge amount', async () => {
    mockCharges([
      charge({
        amount: 10000,
        allocations: [{ amount: 15000, payment: { status: APPROVED } }],
      }),
    ]);

    const report = await service.getFinanceReport('tenant-1', {});

    expect(report.totalPaidByCurrency).toEqual([{ currency: 'ARS', amountMinor: 10000 }]);
    expect(report.totalOutstandingByCurrency).toEqual([{ currency: 'ARS', amountMinor: 0 }]);
  });

  it('F2: over-allocation of 120% produces paid = charge amount and rate 100', async () => {
    mockCharges([
      charge({
        amount: 10000,
        allocations: [{ amount: 12000, payment: { status: APPROVED } }],
      }),
    ]);

    const report = await service.getFinanceReport('tenant-1', {});

    expect(report.totalChargesByCurrency).toEqual([{ currency: 'ARS', amountMinor: 10000 }]);
    expect(report.totalPaidByCurrency).toEqual([{ currency: 'ARS', amountMinor: 10000 }]);
    expect(report.totalOutstandingByCurrency).toEqual([{ currency: 'ARS', amountMinor: 0 }]);
    expect(report.collectionRateByCurrency).toEqual([{ currency: 'ARS', rate: 100 }]);
  });

  it('F3: emitted = paid + outstanding holds per currency (charge-side)', async () => {
    mockCharges([
      charge({
        amount: 2000,
        currency: 'USD',
        allocations: [{ amount: 1000, payment: { status: APPROVED } }],
      }),
      charge({
        id: 'chg-2',
        unitId: 'unit-2',
        amount: 10000,
        allocations: [{ amount: 10000, payment: { status: APPROVED } }],
      }),
    ]);

    const report = await service.getFinanceReport('tenant-1', {});

    expect(report.totalChargesByCurrency).toEqual([
      { currency: 'USD', amountMinor: 2000 },
      { currency: 'ARS', amountMinor: 10000 },
    ]);
    expect(report.totalPaidByCurrency).toEqual([
      { currency: 'USD', amountMinor: 1000 },
      { currency: 'ARS', amountMinor: 10000 },
    ]);
    expect(report.totalOutstandingByCurrency).toEqual([
      { currency: 'USD', amountMinor: 1000 },
      { currency: 'ARS', amountMinor: 0 },
    ]);
    expect(report.collectionRateByCurrency).toEqual([
      { currency: 'USD', rate: 50 },
      { currency: 'ARS', rate: 100 },
    ]);
  });

  it('F4: CROSS payment — allocation amount in Charge currency, never the original currency', async () => {
    // Payment was made in USD (paymentOriginalAmountMinor = 5000) but the
    // allocation covers an ARS charge of 182500. Charge-side math only ever
    // reads allocation.amount (182500 ARS); the USD original never creates
    // a USD bucket.
    mockCharges([
      charge({
        amount: 182500,
        currency: 'ARS',
        allocations: [{ amount: 182500, payment: { status: APPROVED } }],
      }),
    ]);

    const report = await service.getFinanceReport('tenant-1', {});

    expect(report.totalChargesByCurrency).toEqual([{ currency: 'ARS', amountMinor: 182500 }]);
    expect(report.totalPaidByCurrency).toEqual([{ currency: 'ARS', amountMinor: 182500 }]);
    expect(report.totalOutstandingByCurrency).toEqual([{ currency: 'ARS', amountMinor: 0 }]);
    expect(report.collectionRateByCurrency).toEqual([{ currency: 'ARS', rate: 100 }]);
  });

  it('G: empty tenant returns empty buckets and no delinquents', async () => {
    mockCharges([]);

    const report = await service.getFinanceReport('tenant-1', {});

    expect(report.totalChargesByCurrency).toEqual([]);
    expect(report.totalPaidByCurrency).toEqual([]);
    expect(report.totalOutstandingByCurrency).toEqual([]);
    expect(report.collectionRateByCurrency).toEqual([]);
    expect(report.delinquentUnitsCount).toBe(0);
    expect(report.delinquentUnits).toEqual([]);
  });

  it('H: equal dueDate ties are broken deterministically by unitId', async () => {
    const overdue = new Date('2024-01-01T00:00:00Z');
    mockCharges([
      charge({ id: 'c1', unitId: 'unit-usd-small', amount: 1000, currency: 'USD', dueDate: overdue }),
      charge({ id: 'c2', unitId: 'unit-usd-big', amount: 2000, currency: 'USD', dueDate: overdue }),
      charge({ id: 'c3', unitId: 'unit-ves', amount: 5000, currency: 'VES', dueDate: overdue }),
    ]);

    const report = await service.getFinanceReport('tenant-1', {});

    // Same dueDate for all: unitId ASC (amounts and currencies irrelevant).
    expect(report.delinquentUnits.map((u) => u.unitId)).toEqual([
      'unit-usd-big',
      'unit-usd-small',
      'unit-ves',
    ]);
  });

  it('H2: count reflects all delinquent units while list is capped at 10', async () => {
    const overdue = new Date('2024-01-01T00:00:00Z');
    const units = Array.from({ length: 12 }, (_, i) =>
      charge({
        id: `c${i}`,
        unitId: `unit-${i}`,
        amount: 1000,
        currency: 'USD',
        dueDate: overdue,
      }),
    );
    mockCharges(units);

    const report = await service.getFinanceReport('tenant-1', {});

    expect(report.delinquentUnitsCount).toBe(12);
    expect(report.delinquentUnits).toHaveLength(10);
  });

  it('H3: ranking is NON-monetary — earliest delinquency first, then unitId', async () => {
    const overdue = new Date('2024-01-01T00:00:00Z');
    // 13 delinquent units across USD, VES and ARS. Ordering must follow
    // earliest dueDate then unitId — never amounts or currency priority.
    const fixtures = [
      ...Array.from({ length: 6 }, (_, i) =>
        charge({
          id: `c-usd-${i}`,
          unitId: `usd-${i}`,
          amount: 100 + i * 10,
          currency: 'USD',
          dueDate: new Date(`2024-01-${String(10 - i).padStart(2, '0')}T00:00:00Z`),
        }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        charge({
          id: `c-ves-${i}`,
          unitId: `ves-${i}`,
          amount: 50000 + i * 1000,
          currency: 'VES',
          dueDate: new Date(`2024-01-${String(20 - i).padStart(2, '0')}T00:00:00Z`),
        }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        charge({
          id: `c-ars-${i}`,
          unitId: `ars-${i}`,
          amount: 4000000 + i * 100000,
          currency: 'ARS',
          dueDate: new Date(`2024-01-${String(30 - i).padStart(2, '0')}T00:00:00Z`),
        }),
      ),
    ];

    mockCharges(fixtures);
    const forward = await service.getFinanceReport('tenant-1', {});

    mockCharges([...fixtures].reverse());
    const reversed = await service.getFinanceReport('tenant-1', {});

    expect(forward.delinquentUnits).toEqual(reversed.delinquentUnits);

    // Earliest dueDate first regardless of currency or amount:
    // usd-5 (01-05), usd-4 (01-06), ... usd-0 (01-10), ves-3 (01-17),
    // ves-2 (01-18), ves-1 (01-19), ves-0 (01-20), ars-2 (01-28), ars-1
    // (01-29), ars-0 (01-30). An ARS unit with nominal millions can rank
    // LAST — proof that no cross-currency monetary ranking exists.
    const ids = forward.delinquentUnits.map((u) => u.unitId);
    expect(ids).toEqual([
      'usd-5',
      'usd-4',
      'usd-3',
      'usd-2',
      'usd-1',
      'usd-0',
      'ves-3',
      'ves-2',
      'ves-1',
      'ves-0',
    ]);
    expect(forward.delinquentUnitsCount).toBe(13);
    expect(forward.delinquentUnits).toHaveLength(10);
  });

  it('H4: USD 1 never outranks ARS 10M by currency priority — dueDate rules', async () => {
    // Gate fixture: Unit A (USD 1) vs Unit B (ARS 10,000,000) vs
    // Unit C (COP 500,000). No implicit conversion USD > VES > ARS > COP:
    // the ordering is purely earliest-dueDate then unitId.
    const fixtures = [
      charge({
        id: 'c-a',
        unitId: 'unit-a',
        amount: 1,
        currency: 'USD',
        dueDate: new Date('2024-03-01T00:00:00Z'),
      }),
      charge({
        id: 'c-b',
        unitId: 'unit-b',
        amount: 1000000000,
        currency: 'ARS',
        dueDate: new Date('2024-01-01T00:00:00Z'),
      }),
      charge({
        id: 'c-c',
        unitId: 'unit-c',
        amount: 50000000,
        currency: 'COP',
        dueDate: new Date('2024-02-01T00:00:00Z'),
      }),
    ];

    mockCharges([...fixtures].reverse());
    const report = await service.getFinanceReport('tenant-1', {});

    // Oldest delinquency first: unit-b (ARS 10M) before unit-c (COP) before
    // unit-a (USD 1). The tiny USD charge cannot outrank the ARS millions.
    expect(report.delinquentUnits.map((u) => u.unitId)).toEqual([
      'unit-b',
      'unit-c',
      'unit-a',
    ]);
    expect(report.delinquentUnits[0]!.outstandingByCurrency).toEqual([
      { currency: 'ARS', amountMinor: 1000000000 },
    ]);
    expect(report.delinquentUnits[2]!.outstandingByCurrency).toEqual([
      { currency: 'USD', amountMinor: 1 },
    ]);
  });

  it('I: non-overdue or fully paid charges are not delinquent', async () => {
    mockCharges([
      charge({ amount: 5000, dueDate: new Date('2030-01-01T00:00:00Z') }),
      charge({
        id: 'chg-2',
        unitId: 'unit-2',
        amount: 5000,
        dueDate: new Date('2024-01-01T00:00:00Z'),
        allocations: [{ amount: 5000, payment: { status: APPROVED } }],
      }),
    ]);

    const report = await service.getFinanceReport('tenant-1', {});

    expect(report.delinquentUnitsCount).toBe(0);
    expect(report.delinquentUnits).toEqual([]);
  });

  it('J: filters buildingId and period are passed to the query', async () => {
    mockCharges([]);

    await service.getFinanceReport('tenant-1', { buildingId: 'building-9', period: '2024-03' });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        canceledAt: null,
        buildingId: 'building-9',
        period: '2024-03',
      },
      include: {
        paymentAllocations: {
          include: { payment: { select: { status: true } } },
        },
      },
    });
  });

  it('K: legacy currency (UYU) is reported as its own explicit bucket — no 500, no fallback', async () => {
    mockCharges([
      charge({ amount: 5000, currency: 'UYU' }),
      charge({ id: 'chg-2', unitId: 'unit-2', amount: 10000, currency: 'ARS' }),
    ]);

    const report = await service.getFinanceReport('tenant-1', {});

    expect(report.totalChargesByCurrency).toEqual([
      { currency: 'ARS', amountMinor: 10000 },
      { currency: 'UYU', amountMinor: 5000 },
    ]);
    expect(report.totalOutstandingByCurrency).toEqual([
      { currency: 'ARS', amountMinor: 10000 },
      { currency: 'UYU', amountMinor: 5000 },
    ]);
    expect(report.collectionRateByCurrency).toEqual([
      { currency: 'ARS', rate: 0 },
      { currency: 'UYU', rate: 0 },
    ]);
  });

  it('K2: multiple legacy currencies sort lexicographically AFTER canonical ones', async () => {
    mockCharges([
      charge({ amount: 100, currency: 'UYU' }),
      charge({ id: 'chg-2', unitId: 'unit-2', amount: 200, currency: 'GBP' }),
      charge({ id: 'chg-3', unitId: 'unit-3', amount: 300, currency: 'USD' }),
    ]);

    const report = await service.getFinanceReport('tenant-1', {});

    expect(report.totalChargesByCurrency.map((b) => b.currency)).toEqual([
      'USD',
      'GBP',
      'UYU',
    ]);
  });

  it('K3: legacy delinquent unit keeps UYU bucket without mixing currencies', async () => {
    mockCharges([
      charge({
        unitId: 'unit-legacy',
        amount: 5000,
        currency: 'UYU',
        dueDate: new Date('2024-01-01T00:00:00Z'),
      }),
    ]);

    const report = await service.getFinanceReport('tenant-1', {});

    expect(report.delinquentUnits[0]).toEqual({
      unitId: 'unit-legacy',
      outstandingByCurrency: [{ currency: 'UYU', amountMinor: 5000 }],
    });
  });
});

describe('ReportsService.exportFinance', () => {
  let service: ReportsService;
  let findMany: jest.Mock;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    const prisma = { charge: { findMany } } as unknown as PrismaService;
    service = new ReportsService(prisma);
  });

  it('L: emits one SUMMARY row per currency with major-unit amounts', async () => {
    findMany.mockResolvedValue([
      charge({ amount: 10000, currency: 'USD' }),
      charge({ id: 'chg-2', unitId: 'unit-2', amount: 5000, currency: 'ARS' }),
    ]);

    const result = await service.exportFinance('tenant-1', {});

    const lines = result.content.split('\n');
    expect(lines[0]).toBe(
      'type,building,totalCharges,totalPaid,outstanding,collectionRate,currency,unit',
    );
    expect(lines[1]).toBe('SUMMARY,All Buildings,100.00,0.00,100.00,0.00%,USD,');
    expect(lines[2]).toBe('SUMMARY,All Buildings,50.00,0.00,50.00,0.00%,ARS,');
  });

  it('M: delinquent rows are per (unit, currency) with the real currency column', async () => {
    findMany.mockResolvedValue([
      charge({
        unitId: 'unit-1',
        amount: 7000,
        currency: 'VES',
        dueDate: new Date('2024-01-01T00:00:00Z'),
      }),
    ]);

    const result = await service.exportFinance('tenant-1', {});

    const lines = result.content.split('\n');
    expect(lines).toContain('SUMMARY,All Buildings,70.00,0.00,70.00,0.00%,VES,');
    expect(lines).toContain('DELINQUENT,,,,70.00,,VES,unit-1');
  });

  it('N: empty tenant exports only the header row', async () => {
    findMany.mockResolvedValue([]);

    const result = await service.exportFinance('tenant-1', {});

    expect(result.content.split('\n').filter(Boolean)).toEqual([
      'type,building,totalCharges,totalPaid,outstanding,collectionRate,currency,unit',
    ]);
  });

  it('O: CSV round-trip parses with equal column counts and explicit currency/unit', async () => {
    findMany.mockResolvedValue([
      charge({
        id: 'c1',
        unitId: 'unit-"odd,1',
        amount: 12345,
        currency: 'USD',
        dueDate: new Date('2024-01-01T00:00:00Z'),
      }),
      charge({
        id: 'c2',
        unitId: 'unit-2',
        amount: 67890,
        currency: 'ARS',
        allocations: [{ amount: 67890, payment: { status: APPROVED } }],
      }),
    ]);

    const result = await service.exportFinance('tenant-1', {});

    // Standard CSV parser semantics: fields with comma/quote are quoted,
    // inner quotes doubled.
    const rows = parseCsvRows(result.content);

    const headers = rows[0];
    expect(headers).toEqual([
      'type',
      'building',
      'totalCharges',
      'totalPaid',
      'outstanding',
      'collectionRate',
      'currency',
      'unit',
    ]);

    // The seven historical columns keep their exact original positions.
    expect(headers.slice(0, 7)).toEqual([
      'type',
      'building',
      'totalCharges',
      'totalPaid',
      'outstanding',
      'collectionRate',
      'currency',
    ]);

    // Every data row has exactly the same column count as the header.
    for (const row of rows.slice(1)) {
      expect(row.length).toBe(headers.length);
    }

    // Summary rows: one per currency, never mixed; unit column empty.
    // Column order: type(0) building(1) totalCharges(2) totalPaid(3)
    // outstanding(4) collectionRate(5) currency(6) unit(7).
    const usdSummary = rows.find((r) => r[0] === 'SUMMARY' && r[6] === 'USD');
    const arsSummary = rows.find((r) => r[0] === 'SUMMARY' && r[6] === 'ARS');
    expect(usdSummary).toBeTruthy();
    expect(arsSummary).toBeTruthy();
    expect(usdSummary![7]).toBe('');
    expect(arsSummary![7]).toBe('');
    // Amounts are major units: 12345 minor -> 123.45.
    expect(usdSummary![3]).toBe('0.00');
    expect(usdSummary![4]).toBe('123.45');
    expect(arsSummary![3]).toBe('678.90');
    expect(arsSummary![4]).toBe('0.00');

    // Delinquent row keeps the escaping unit in the unit column (index 7)
    // and the real currency in the currency column (index 6).
    const unitIndex = rows.findIndex((r) => r[0] === 'DELINQUENT');
    expect(unitIndex).toBeGreaterThan(-1);
    expect(rows[unitIndex][7]).toBe('unit-"odd,1');
    expect(rows[unitIndex][6]).toBe('USD');
    expect(rows[unitIndex][4]).toBe('123.45');
  });

  it('P: legacy currency (UYU) is exported with explicit currency column', async () => {
    findMany.mockResolvedValue([
      charge({
        amount: 500000,
        currency: 'UYU',
        dueDate: new Date('2024-01-01T00:00:00Z'),
      }),
    ]);

    const result = await service.exportFinance('tenant-1', {});

    const rows = parseCsvRows(result.content);
    const summary = rows.find((r) => r[0] === 'SUMMARY');
    expect(summary).toBeTruthy();
    expect(summary![6]).toBe('UYU');
    expect(summary![2]).toBe('5000.00');
    expect(summary![4]).toBe('5000.00');
    const delinquent = rows.find((r) => r[0] === 'DELINQUENT');
    expect(delinquent![6]).toBe('UYU');
    expect(delinquent![4]).toBe('5000.00');
    expect(delinquent![7]).toBe('unit-1');
  });
});

/**
 * Minimal RFC-4180-style CSV parser for test assertions: splits on commas
 * outside quoted fields, handles doubled inner quotes and newlines inside
 * quoted fields.
 */
function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
