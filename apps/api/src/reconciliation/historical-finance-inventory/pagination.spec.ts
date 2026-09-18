import {
  createBoundedFindingMetadata,
  paginateDeterministically,
  PaginationContractError,
} from './paginator';
import { FinancePageReader, HistoricalFinanceRecord } from './contracts';

function records(count: number): readonly HistoricalFinanceRecord[] {
  return Array.from({ length: count }, (_, index) => ({ id: `id-${String(index).padStart(3, '0')}`, createdSequence: index }));
}

function pagedReader(rows: readonly HistoricalFinanceRecord[], calls: { limit: number; cursor?: string }[]): FinancePageReader {
  return {
    listPage: async ({ limit, cursor }) => {
      calls.push({ limit, ...(cursor ? { cursor } : {}) });
      const start = cursor ? Number(cursor) : 0;
      const page = rows.slice(start, start + limit);
      const next = start + page.length;
      return { records: page, ...(next < rows.length ? { nextCursor: String(next) } : {}) };
    },
  };
}

describe('deterministic finance pagination', () => {
  it('requests stable 100-record pages for 201 records on identical runs', async () => {
    const rows = records(201);
    const firstCalls: { limit: number; cursor?: string }[] = [];
    const secondCalls: { limit: number; cursor?: string }[] = [];

    await expect(paginateDeterministically(pagedReader(rows, firstCalls))).resolves.toEqual({ pagesRead: 3, recordsRead: 201 });
    await expect(paginateDeterministically(pagedReader(rows, secondCalls))).resolves.toEqual({ pagesRead: 3, recordsRead: 201 });
    expect(firstCalls).toEqual(secondCalls);
    expect(firstCalls.map((call) => call.limit)).toEqual([100, 100, 100]);
  });

  it('accepts an empty terminal page but rejects malformed, duplicate, and non-advancing cursors', async () => {
    const empty: FinancePageReader = { listPage: async () => ({ records: [] }) };
    await expect(paginateDeterministically(empty)).resolves.toEqual({ pagesRead: 1, recordsRead: 0 });

    const invalidCases: readonly FinancePageReader[] = [
      { listPage: async () => ({ records: 'not-records' } as unknown as ReturnType<FinancePageReader['listPage']>) },
      { listPage: async ({ cursor }) => ({ records: [], nextCursor: cursor ?? 'same' }) },
    ];
    for (const reader of invalidCases) {
      await expect(paginateDeterministically(reader)).rejects.toBeInstanceOf(PaginationContractError);
    }
  });

  it('rejects unstable record ordering and caps finding metadata without retaining findings', async () => {
    const unordered: FinancePageReader = {
      listPage: async () => ({ records: [{ id: 'b', createdSequence: 2 }, { id: 'a', createdSequence: 1 }] }),
    };
    await expect(paginateDeterministically(unordered)).rejects.toThrow('stable ascending order');

    const findings = createBoundedFindingMetadata();
    for (let index = 0; index < 1_001; index += 1) findings.recordFinding();
    expect(findings.metadata()).toEqual({ recordedFindings: 1_000, findingsTruncated: true });
  });

  it('rejects a cursor repeated by a later non-empty page', async () => {
    let calls = 0;
    const duplicateCursor: FinancePageReader = {
      listPage: async () => {
        calls += 1;
        return calls === 1
          ? { records: [{ id: 'first', createdSequence: 1 }], nextCursor: 'next-page' }
          : { records: [{ id: 'second', createdSequence: 2 }], nextCursor: 'next-page' };
      },
    };

    await expect(paginateDeterministically(duplicateCursor)).rejects.toBeInstanceOf(PaginationContractError);
  });

  it('preserves an adapter read failure without advancing the scan', async () => {
    const readFailure = new Error('reader unavailable');
    const unavailable: FinancePageReader = {
      listPage: async () => Promise.reject(readFailure),
    };

    await expect(paginateDeterministically(unavailable)).rejects.toBe(readFailure);
  });
});
