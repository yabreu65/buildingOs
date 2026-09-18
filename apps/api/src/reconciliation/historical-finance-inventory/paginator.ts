import {
  FinancePage,
  FinancePageReader,
  HistoricalFinanceRecord,
} from './contracts';

export const FINANCE_INVENTORY_PAGE_SIZE = 100;
export const MAX_RECORDED_FINDINGS = 1_000;

export class PaginationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaginationContractError';
  }
}

export interface PaginationMetadata {
  readonly pagesRead: number;
  readonly recordsRead: number;
}

export interface BoundedFindingMetadata {
  readonly recordedFindings: number;
  readonly findingsTruncated: boolean;
}

export interface BoundedFindingTracker {
  recordFinding(): void;
  metadata(): BoundedFindingMetadata;
}

function isHistoricalFinanceRecord(value: unknown): value is HistoricalFinanceRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as HistoricalFinanceRecord;
  return typeof record.id === 'string'
    && record.id.length > 0
    && Number.isInteger(record.createdSequence)
    && record.createdSequence >= 0;
}

function isFinancePage(value: unknown): value is FinancePage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const page = value as FinancePage;
  return Array.isArray(page.records)
    && page.records.length <= FINANCE_INVENTORY_PAGE_SIZE
    && page.records.every(isHistoricalFinanceRecord)
    && (page.nextCursor === undefined || typeof page.nextCursor === 'string');
}

function compareRecords(left: HistoricalFinanceRecord, right: HistoricalFinanceRecord): number {
  if (left.createdSequence !== right.createdSequence) {
    return left.createdSequence - right.createdSequence;
  }

  return left.id.localeCompare(right.id);
}

function assertStableOrdering(records: readonly HistoricalFinanceRecord[], previous?: HistoricalFinanceRecord): void {
  let prior = previous;
  for (const record of records) {
    if (prior !== undefined && compareRecords(prior, record) >= 0) {
      throw new PaginationContractError('Finance pages must use stable ascending order by creation sequence and ID');
    }
    prior = record;
  }
}

/**
 * Reads a complete entity through opaque cursor pagination. Cursor values stay
 * inside this function and only aggregate page and record counts are returned.
 */
export async function paginateDeterministically(
  reader: FinancePageReader,
  onPage?: (records: readonly HistoricalFinanceRecord[]) => void,
): Promise<PaginationMetadata> {
  let cursor: string | undefined;
  let previousRecord: HistoricalFinanceRecord | undefined;
  let pagesRead = 0;
  let recordsRead = 0;
  const seenCursors = new Set<string>();

  do {
    const page = await reader.listPage({
      limit: FINANCE_INVENTORY_PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!isFinancePage(page)) {
      throw new PaginationContractError('Finance reader returned a malformed page');
    }

    pagesRead += 1;
    assertStableOrdering(page.records, previousRecord);
    previousRecord = page.records.length > 0
      ? page.records[page.records.length - 1]
      : previousRecord;
    recordsRead += page.records.length;
    onPage?.(page.records);

    if (page.nextCursor !== undefined) {
      if (page.records.length === 0) {
        throw new PaginationContractError('Finance reader cannot advance from an empty page');
      }
      if (seenCursors.has(page.nextCursor) || page.nextCursor === cursor) {
        throw new PaginationContractError('Finance reader returned a duplicate or non-advancing cursor');
      }
      seenCursors.add(page.nextCursor);
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);

  return { pagesRead, recordsRead };
}

/** Tracks aggregate finding-cap state without retaining the findings themselves. */
export function createBoundedFindingMetadata(maxFindings = MAX_RECORDED_FINDINGS): BoundedFindingTracker {
  if (!Number.isInteger(maxFindings) || maxFindings < 0) {
    throw new RangeError('maxFindings must be a non-negative integer');
  }

  let recordedFindings = 0;
  let findingsTruncated = false;
  return {
    recordFinding(): void {
      if (recordedFindings < maxFindings) {
        recordedFindings += 1;
      } else {
        findingsTruncated = true;
      }
    },
    metadata(): BoundedFindingMetadata {
      return { recordedFindings, findingsTruncated };
    },
  };
}
