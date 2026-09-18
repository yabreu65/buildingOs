import { HistoricalFinanceFindingAggregator } from './aggregator';
import { classifyFinanceCondition, FinanceClassification } from './classifier';
import {
  FINANCE_INVENTORY_ENTITIES,
  FinanceInventoryCounterpartEvidence,
  FinanceInventoryEntity,
  FinanceInventoryRecord,
  FinancePage,
  ReadOnlyFinanceInventoryAdapter,
} from './contracts';
import { FINANCE_INVENTORY_PAGE_SIZE, PaginationContractError } from './paginator';
import {
  createClassificationTotals,
  createCoverageCounts,
  HistoricalFinanceInventoryResult,
  redactionMetadata,
  resolveInventoryStatus,
} from './result';

export interface HistoricalFinanceInventoryScannerOptions {
  readonly maxFindings?: number;
}

interface FinancePageLike {
  readonly records?: unknown;
  readonly nextCursor?: unknown;
}

interface PaginationMetadata {
  readonly pagesRead: number;
  readonly recordsRead: number;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError('maxFindings must be a non-negative integer');
  }
  return value;
}

function isFinanceInventoryRecord(value: unknown): value is FinanceInventoryRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as FinanceInventoryRecord;
  return typeof record.id === 'string'
    && record.id.length > 0
    && Number.isInteger(record.createdSequence)
    && record.createdSequence >= 0;
}

function isFinancePage(value: unknown): value is FinancePage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const page = value as FinancePageLike;
  return Array.isArray(page.records)
    && page.records.length <= FINANCE_INVENTORY_PAGE_SIZE
    && page.records.every(isFinanceInventoryRecord)
    && (page.nextCursor === undefined || typeof page.nextCursor === 'string');
}

function compareRecords(left: Pick<FinanceInventoryRecord, 'id' | 'createdSequence'>, right: Pick<FinanceInventoryRecord, 'id' | 'createdSequence'>): number {
  if (left.createdSequence !== right.createdSequence) {
    return left.createdSequence - right.createdSequence;
  }

  return left.id.localeCompare(right.id);
}

function assertStableOrdering(
  records: readonly FinanceInventoryRecord[],
  previous?: Pick<FinanceInventoryRecord, 'id' | 'createdSequence'>,
): Pick<FinanceInventoryRecord, 'id' | 'createdSequence'> | undefined {
  let prior = previous;
  for (const record of records) {
    if (prior !== undefined && compareRecords(prior, record) >= 0) {
      throw new PaginationContractError('Finance pages must use stable ascending order by creation sequence and ID');
    }
    prior = { id: record.id, createdSequence: record.createdSequence };
  }
  return prior;
}

function evidenceFromRecord(record: FinanceInventoryRecord): FinanceInventoryCounterpartEvidence {
  return {
    present: true,
    ...(record.tenantToken === undefined ? {} : { tenantToken: record.tenantToken }),
    ...(record.currencyCode === undefined ? {} : { currencyCode: record.currencyCode }),
    ...(record.currencyStatuses === undefined ? {} : { currencyStatuses: record.currencyStatuses }),
  };
}

function conditionFor(
  entity: FinanceInventoryEntity,
  record: FinanceInventoryRecord,
  counterpart: FinanceInventoryCounterpartEvidence | undefined,
) {
  const counterpartRequired = record.requiresCounterpart === true;
  const currencyRequired = record.requiresCurrency === true;
  const counterpartPresent = !counterpartRequired || counterpart?.present === true;
  const sameTenant = record.tenantToken !== undefined
    && (counterpart === undefined
      ? !counterpartRequired
      : counterpart.present
        && counterpart.tenantToken !== undefined
        && record.tenantToken === counterpart.tenantToken);
  const currencyCompatible = record.currencyCompatible === false
    ? false
    : record.currencyCompatible === true
      ? true
      : !currencyRequired || (
        counterpart?.present === true
        && record.currencyCode !== undefined
        && counterpart.currencyCode !== undefined
        && record.currencyCode === counterpart.currencyCode
      );
  const currencyStatuses = [
    ...(record.currencyStatuses ?? []),
    ...(counterpart?.present === true ? counterpart.currencyStatuses ?? [] : []),
  ];

  return {
    entity,
    counterpartPresent,
    sameTenant,
    currencyCompatible,
    currencyStatuses,
    invariantValid: record.invariantValid !== false,
    representation: record.representation,
  };
}

/**
 * Scans only the adapter's read-only capability and returns redacted aggregates.
 * It never returns source records, relationship IDs, tenant tokens, or cursors.
 */
export class HistoricalFinanceInventoryScanner {
  private readonly maxFindings: number;

  constructor(
    private readonly adapter: ReadOnlyFinanceInventoryAdapter,
    options: HistoricalFinanceInventoryScannerOptions = {},
  ) {
    this.maxFindings = nonNegativeInteger(options.maxFindings, 1_000);
  }

  async scan(): Promise<HistoricalFinanceInventoryResult> {
    const startedAt = new Date().toISOString();
    const coverageCounts = createCoverageCounts();
    const classificationTotals = createClassificationTotals();
    const findingCategoryCounts: Record<string, number> = {};
    const findings = new HistoricalFinanceFindingAggregator(this.maxFindings);
    let pagesRead = 0;
    let recordsRead = 0;

    try {
      for (const entity of FINANCE_INVENTORY_ENTITIES) {
        const pageMetadata = await this.scanEntity(entity, async (page) => {
          const currentBatch = new Map(page.map((record) => [record.id, evidenceFromRecord(record)]));
          const correlationCache = new Map<string, FinanceInventoryCounterpartEvidence | undefined>();
          for (const record of page) {
            const counterpart = await this.resolveCounterpart(entity, record, currentBatch, correlationCache);
            findings.record(classifyFinanceCondition(conditionFor(entity, record, counterpart)));
          }
        });
        coverageCounts[entity] = pageMetadata.recordsRead;
        pagesRead += pageMetadata.pagesRead;
        recordsRead += pageMetadata.recordsRead;
      }
    } catch (error: unknown) {
      const operationalErrorCode = error instanceof PaginationContractError
        ? 'PAGINATION_CONTRACT_INVALID'
        : 'ADAPTER_READ_FAILED';
      return this.result(
        startedAt,
        coverageCounts,
        classificationTotals,
        findingCategoryCounts,
        pagesRead,
        recordsRead,
        0,
        false,
        operationalErrorCode,
      );
    }

    return this.result(
      startedAt,
      coverageCounts,
      findings.classificationTotals(),
      findings.findingCategoryCounts(),
      pagesRead,
      recordsRead,
      findings.recordedFindings(),
      findings.findingsTruncated(),
    );
  }

  private async scanEntity(
    entity: FinanceInventoryEntity,
    onPage: (records: readonly FinanceInventoryRecord[]) => Promise<void>,
  ): Promise<PaginationMetadata> {
    let cursor: string | undefined;
    let previous: Pick<FinanceInventoryRecord, 'id' | 'createdSequence'> | undefined;
    let pagesRead = 0;
    let recordsRead = 0;

    do {
      const page = await this.adapter.listPage(entity, {
        limit: FINANCE_INVENTORY_PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!isFinancePage(page)) {
        throw new PaginationContractError('Finance reader returned a malformed page');
      }

      pagesRead += 1;
      previous = assertStableOrdering(page.records, previous);
      recordsRead += page.records.length;
      await onPage(page.records);

      if (page.nextCursor !== undefined) {
        if (page.records.length === 0) {
          throw new PaginationContractError('Finance reader cannot advance from an empty page');
        }
        if (page.nextCursor === cursor) {
          throw new PaginationContractError('Finance reader returned a non-advancing cursor');
        }
      }
      cursor = page.nextCursor;
    } while (cursor !== undefined);

    return { pagesRead, recordsRead };
  }

  private async resolveCounterpart(
    entity: FinanceInventoryEntity,
    record: FinanceInventoryRecord,
    currentBatch: ReadonlyMap<string, FinanceInventoryCounterpartEvidence>,
    correlationCache: Map<string, FinanceInventoryCounterpartEvidence | undefined>,
  ): Promise<FinanceInventoryCounterpartEvidence | undefined> {
    if (record.requiresCounterpart !== true) {
      return undefined;
    }
    if (record.counterpartEvidence !== undefined) {
      return record.counterpartEvidence;
    }
    if (record.counterpartEntity === undefined || record.counterpartId === undefined) {
      return undefined;
    }
    if (record.counterpartEntity === entity) {
      return currentBatch.get(record.counterpartId);
    }

    const correlationKey = `${record.counterpartEntity}:${record.counterpartId}`;
    if (correlationCache.has(correlationKey)) {
      return correlationCache.get(correlationKey);
    }

    const counterpart = await this.findCounterpart(record.counterpartEntity, record.counterpartId);
    correlationCache.set(correlationKey, counterpart);
    return counterpart;
  }

  private async findCounterpart(
    entity: FinanceInventoryEntity,
    counterpartId: string,
  ): Promise<FinanceInventoryCounterpartEvidence | undefined> {
    let cursor: string | undefined;
    let previous: Pick<FinanceInventoryRecord, 'id' | 'createdSequence'> | undefined;

    do {
      const page = await this.adapter.listPage(entity, {
        limit: FINANCE_INVENTORY_PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor }),
      });
      if (!isFinancePage(page)) {
        throw new PaginationContractError('Finance reader returned a malformed page');
      }

      previous = assertStableOrdering(page.records, previous);
      const counterpart = page.records.find((candidate) => candidate.id === counterpartId);
      if (counterpart !== undefined) {
        return evidenceFromRecord(counterpart);
      }

      if (page.nextCursor !== undefined) {
        if (page.records.length === 0) {
          throw new PaginationContractError('Finance reader cannot advance from an empty page');
        }
        if (page.nextCursor === cursor) {
          throw new PaginationContractError('Finance reader returned a non-advancing cursor');
        }
      }
      cursor = page.nextCursor;
    } while (cursor !== undefined);

    return undefined;
  }

  private result(
    startedAt: string,
    coverageCounts: HistoricalFinanceInventoryResult['coverageCounts'],
    classificationTotals: Record<FinanceClassification, number>,
    findingCategoryCounts: Readonly<Record<string, number>>,
    pagesRead: number,
    recordsRead: number,
    recordedFindings: number,
    findingsTruncated: boolean,
    operationalErrorCode?: HistoricalFinanceInventoryResult['operationalErrorCode'],
  ): HistoricalFinanceInventoryResult {
    return {
      schemaVersion: 'historical-finance-inventory/v1',
      status: resolveInventoryStatus(classificationTotals, findingsTruncated, operationalErrorCode),
      startedAt,
      completedAt: new Date().toISOString(),
      coverageCounts,
      classificationTotals,
      findingCategoryCounts,
      pagesRead,
      recordsRead,
      recordedFindings,
      findingsTruncated,
      ...(operationalErrorCode === undefined ? {} : { operationalErrorCode }),
      redaction: redactionMetadata(),
    };
  }
}
