import {
  FINANCE_INVENTORY_ENTITIES,
  FinanceInventoryEntity,
  FinanceInventoryRecord,
  ReadOnlyFinanceInventoryAdapter,
} from './contracts';
import { HistoricalFinanceInventoryScanner } from './scanner';

function record(
  entity: FinanceInventoryEntity,
  index: number,
  overrides: Partial<FinanceInventoryRecord> = {},
): FinanceInventoryRecord {
  return {
    id: `${entity}-${index}`,
    createdSequence: index,
    tenantToken: 'tenant-a',
    currencyCode: 'USD',
    currencyStatuses: ['CANONICAL_CURRENT'],
    representation: 'CURRENT',
    ...overrides,
  };
}

function adapter(recordsByEntity: Partial<Record<FinanceInventoryEntity, readonly FinanceInventoryRecord[]>>): ReadOnlyFinanceInventoryAdapter {
  return {
    async listPage(entity, { cursor, limit }) {
      const records = recordsByEntity[entity] ?? [];
      const start = cursor === undefined ? 0 : Number(cursor);
      const page = records.slice(start, start + limit);
      const next = start + page.length;
      return {
        records: page,
        ...(next < records.length ? { nextCursor: String(next) } : {}),
      };
    },
  };
}

describe('historical finance aggregate scanner', () => {
  it('covers every entity independently with aggregate-only clean output', async () => {
    const source = Object.fromEntries(
      FINANCE_INVENTORY_ENTITIES.map((entity) => [entity, [record(entity, 1)]]),
    ) as Record<FinanceInventoryEntity, readonly FinanceInventoryRecord[]>;

    const result = await new HistoricalFinanceInventoryScanner(adapter(source)).scan();

    expect(result.status).toBe('COMPLETE_CLEAN');
    expect(result.coverageCounts).toEqual(Object.fromEntries(FINANCE_INVENTORY_ENTITIES.map((entity) => [entity, 1])));
    expect(result.classificationTotals).toEqual({ SAFE: 14, LEGACY_SUPPORTED: 0, REPAIRABLE: 0, INVALID_BLOCKING: 0 });
    expect(JSON.stringify(result)).not.toContain('tenant-a');
    expect(JSON.stringify(result)).not.toContain('liquidations-1');
  });

  it('aggregates legacy, repairable, and blocking relationship outcomes with blocking precedence', async () => {
    const source: Partial<Record<FinanceInventoryEntity, readonly FinanceInventoryRecord[]>> = {
      charges: [record('charges', 1)],
      liquidations: [record('liquidations', 1, { representation: 'V1', requiresCounterpart: true, counterpartEntity: 'charges', counterpartId: 'charges-1', requiresCurrency: true })],
      payments: [record('payments', 1, { tenantToken: 'tenant-b' })],
      paymentAllocations: [record('paymentAllocations', 1, { requiresCounterpart: true, counterpartEntity: 'payments', counterpartId: 'payments-1', requiresCurrency: true })],
      expenses: [record('expenses', 1, { representation: 'V9' })],
      incomes: [record('incomes', 1, { representation: 'LEGACY_INCOME' })],
      adjustments: [record('adjustments', 1, { requiresCounterpart: true, counterpartEntity: 'charges', counterpartId: 'missing' })],
    };

    const result = await new HistoricalFinanceInventoryScanner(adapter(source)).scan();

    expect(result.status).toBe('COMPLETE_WITH_BLOCKING_FINDINGS');
    expect(result.classificationTotals).toEqual({ SAFE: 2, LEGACY_SUPPORTED: 2, REPAIRABLE: 1, INVALID_BLOCKING: 2 });
    expect(result.findingCategoryCounts).toEqual({ SUPPORTED_LEGACY: 2, UNSUPPORTED_VARIANT: 1, CROSS_TENANT: 1, MISSING_COUNTERPART: 1 });
  });

  it('classifies missing ownership evidence as cross-tenant when a counterpart is required', async () => {
    const source: Partial<Record<FinanceInventoryEntity, readonly FinanceInventoryRecord[]>> = {
      payments: [record('payments', 1, { tenantToken: undefined })],
      paymentAllocations: [record('paymentAllocations', 1, {
        requiresCounterpart: true,
        counterpartEntity: 'payments',
        counterpartId: 'payments-1',
        tenantToken: undefined,
      })],
    };

    const result = await new HistoricalFinanceInventoryScanner(adapter(source)).scan();

    expect(result.status).toBe('COMPLETE_WITH_BLOCKING_FINDINGS');
    expect(result.classificationTotals.INVALID_BLOCKING).toBe(2);
    expect(result.findingCategoryCounts).toEqual({ CROSS_TENANT: 2 });
  });

  it('uses explicit persisted cross-currency allocation evidence instead of demanding nominal equality', async () => {
    const source: Partial<Record<FinanceInventoryEntity, readonly FinanceInventoryRecord[]>> = {
      payments: [record('payments', 1, { currencyCode: 'USD' })],
      paymentAllocations: [record('paymentAllocations', 1, {
        currencyCode: 'ARS',
        requiresCounterpart: true,
        counterpartEntity: 'payments',
        counterpartId: 'payments-1',
        requiresCurrency: true,
        currencyCompatible: true,
      })],
    };

    const result = await new HistoricalFinanceInventoryScanner(adapter(source)).scan();

    expect(result.status).toBe('COMPLETE_CLEAN');
    expect(result.classificationTotals).toEqual({ SAFE: 2, LEGACY_SUPPORTED: 0, REPAIRABLE: 0, INVALID_BLOCKING: 0 });
  });

  it('classifies canonical, stored legacy, malformed, and contradictory currency evidence', async () => {
    const source: Partial<Record<FinanceInventoryEntity, readonly FinanceInventoryRecord[]>> = {
      payments: [
        record('payments', 1, { currencyCode: 'ARS', currencyStatuses: ['CANONICAL_CURRENT'] }),
        record('payments', 2, { currencyCode: 'UYU', currencyStatuses: ['LEGACY_STORED'] }),
        record('payments', 3, { currencyCode: 'US', currencyStatuses: ['MALFORMED'] }),
      ],
      paymentAllocations: [
        record('paymentAllocations', 1, {
          currencyCode: 'ARS',
          currencyStatuses: ['CANONICAL_CURRENT'],
          requiresCounterpart: true,
          counterpartEntity: 'payments',
          counterpartId: 'payments-1',
          requiresCurrency: true,
        }),
        record('paymentAllocations', 2, {
          currencyCode: 'UYU',
          currencyStatuses: ['LEGACY_STORED'],
          requiresCounterpart: true,
          counterpartEntity: 'payments',
          counterpartId: 'payments-2',
          requiresCurrency: true,
        }),
        record('paymentAllocations', 3, {
          currencyCode: 'US',
          currencyStatuses: ['MALFORMED'],
          requiresCounterpart: true,
          counterpartEntity: 'payments',
          counterpartId: 'payments-3',
          requiresCurrency: true,
        }),
        record('paymentAllocations', 4, {
          currencyCode: 'ARS',
          currencyStatuses: ['CANONICAL_CURRENT'],
          currencyCompatible: false,
          requiresCounterpart: true,
          counterpartEntity: 'payments',
          counterpartId: 'payments-1',
          requiresCurrency: true,
        }),
      ],
    };

    const result = await new HistoricalFinanceInventoryScanner(adapter(source)).scan();

    expect(result.classificationTotals).toEqual({ SAFE: 2, LEGACY_SUPPORTED: 2, REPAIRABLE: 2, INVALID_BLOCKING: 1 });
    expect(result.findingCategoryCounts).toEqual({ SUPPORTED_LEGACY: 2, MALFORMED_CURRENCY: 2, CURRENCY_INVALID: 1 });
  });

  it('does not rescan a counterpart entity when mapped relation evidence is present', async () => {
      const source: Partial<Record<FinanceInventoryEntity, readonly FinanceInventoryRecord[]>> = {
        paymentAllocations: [record('paymentAllocations', 1, {
          requiresCounterpart: true,
          counterpartEntity: 'payments',
          counterpartId: 'payment-1',
          requiresCurrency: true,
          counterpartEvidence: { present: true, tenantToken: 'tenant-a', currencyCode: 'USD', currencyStatuses: ['CANONICAL_CURRENT'] },
        })],
      };
      const sourceAdapter = adapter(source);
      const calls: FinanceInventoryEntity[] = [];
      const instrumented: ReadOnlyFinanceInventoryAdapter = {
        async listPage(entity, request) {
          calls.push(entity);
          return sourceAdapter.listPage(entity, request);
        },
      };

      await expect(new HistoricalFinanceInventoryScanner(instrumented).scan()).resolves.toMatchObject({
        status: 'COMPLETE_CLEAN',
      });
      expect(calls.filter((entity) => entity === 'payments')).toHaveLength(1);
    });

    it('retains counterpart lookup fallback for adapter-neutral synthetic readers', async () => {
      const source: Partial<Record<FinanceInventoryEntity, readonly FinanceInventoryRecord[]>> = {
        payments: [record('payments', 1)],
        paymentAllocations: [record('paymentAllocations', 1, {
          requiresCounterpart: true,
          counterpartEntity: 'payments',
          counterpartId: 'payments-1',
          requiresCurrency: true,
        })],
      };
      const sourceAdapter = adapter(source);
      const calls: FinanceInventoryEntity[] = [];
      const instrumented: ReadOnlyFinanceInventoryAdapter = {
        async listPage(entity, request) {
          calls.push(entity);
          return sourceAdapter.listPage(entity, request);
        },
      };

      await expect(new HistoricalFinanceInventoryScanner(instrumented).scan()).resolves.toMatchObject({
        status: 'COMPLETE_CLEAN',
      });
      expect(calls.filter((entity) => entity === 'payments')).toHaveLength(2);
    });

    it('processes many pages while each page remains the only live record state', async () => {
    const pageSize = 100;
    const pageCount = 120;
    const recordsPerPage = pageSize;
    let activePage = -1;

    const guardedRecord = (page: number, index: number): FinanceInventoryRecord => {
      const assertCurrentPage = (): void => {
        if (activePage !== page) {
          throw new Error('scanner retained a record beyond its source page');
        }
      };
      const sequence = page * recordsPerPage + index;
      return {
        get id() {
          assertCurrentPage();
          return `expenses-${sequence}`;
        },
        get createdSequence() {
          assertCurrentPage();
          return sequence;
        },
        get tenantToken() {
          assertCurrentPage();
          return 'tenant-a';
        },
        get currencyCode() {
          assertCurrentPage();
          return 'USD';
        },
        get representation() {
          assertCurrentPage();
          return 'CURRENT';
        },
      };
    };
    const paged: ReadOnlyFinanceInventoryAdapter = {
      async listPage(entity, { cursor }) {
        if (entity !== 'expenses') {
          return { records: [] };
        }
        const start = cursor === undefined ? 0 : Number(cursor);
        activePage = Math.floor(start / pageSize);
        const records = Array.from(
          { length: Math.min(pageSize, pageCount * pageSize - start) },
          (_, index) => guardedRecord(activePage, start + index),
        );
        const next = start + records.length;
        return {
          records,
          ...(next < pageCount * pageSize ? { nextCursor: String(next) } : {}),
        };
      },
    };

    const result = await new HistoricalFinanceInventoryScanner(paged).scan();

    expect(result.status).toBe('COMPLETE_CLEAN');
    expect(result.coverageCounts.expenses).toBe(pageCount * pageSize);
    expect(result.recordsRead).toBe(pageCount * pageSize);
    expect(result.classificationTotals.SAFE).toBe(pageCount * pageSize);
  });

  it('fails closed on read errors and marks finding-cap truncation as blocking', async () => {
    const failing: ReadOnlyFinanceInventoryAdapter = {
      listPage: async () => Promise.reject(new Error('database password must stay secret')),
    };
    await expect(new HistoricalFinanceInventoryScanner(failing).scan()).resolves.toMatchObject({
      status: 'INCOMPLETE_OPERATIONAL_ERROR',
      operationalErrorCode: 'ADAPTER_READ_FAILED',
    });

    const findings = Array.from({ length: 1_001 }, (_, index) => record('expenses', index, { representation: 'V9' }));
    const result = await new HistoricalFinanceInventoryScanner(adapter({ expenses: findings })).scan();
    expect(result.status).toBe('COMPLETE_WITH_BLOCKING_FINDINGS');
    expect(result.findingsTruncated).toBe(true);
    expect(result.recordedFindings).toBe(1_000);
  });
});
