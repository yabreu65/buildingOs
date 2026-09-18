import {
  FINANCE_INVENTORY_ENTITIES,
  FinanceInventoryEntity,
} from './contracts';
import {
  FinanceClassification,
  FinanceFindingCategory,
} from './classifier';
import type { HistoricalInventoryReceipt } from '../historical-inventory/historical-inventory.types';

export type HistoricalFinanceInventoryStatus =
  | 'COMPLETE_CLEAN'
  | 'COMPLETE_WITH_FINDINGS'
  | 'COMPLETE_WITH_BLOCKING_FINDINGS'
  | 'INCOMPLETE_OPERATIONAL_ERROR';

export interface HistoricalFinanceInventoryResult {
  readonly schemaVersion: 'historical-finance-inventory/v1';
  readonly status: HistoricalFinanceInventoryStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly coverageCounts: Record<FinanceInventoryEntity, number>;
  readonly classificationTotals: Record<FinanceClassification, number>;
  readonly findingCategoryCounts: Readonly<Record<string, number>>;
  readonly pagesRead: number;
  readonly recordsRead: number;
  readonly recordedFindings: number;
  readonly findingsTruncated: boolean;
  readonly operationalErrorCode?: 'ADAPTER_READ_FAILED' | 'PAGINATION_CONTRACT_INVALID' | 'RECEIPT_WRITE_FAILED';
  readonly redaction: {
    readonly tenantIdentifiers: 'excluded';
    readonly recordIdentifiers: 'excluded';
    readonly amounts: 'excluded';
    readonly cursors: 'excluded';
    readonly rawPayloads: 'excluded';
    readonly stackTraces: 'excluded';
  };
}

export type StorageInventoryAggregateStatus =
  | 'SKIPPED_CONFIG_UNAVAILABLE'
  | 'COMPLETE_CLEAN'
  | 'COMPLETE_WITH_FINDINGS'
  | 'INCOMPLETE_OPERATIONAL_ERROR';

export interface StorageInventoryAggregateSummary {
  /** Existing integrations may carry an independently produced aggregate status. */
  readonly status: StorageInventoryAggregateStatus | string;
  readonly counts: Readonly<Record<string, number>>;
  readonly operationalErrorCode?: 'STORAGE_SCAN_FAILED';
}

export interface HistoricalFinanceInventoryCompositeReceipt {
  readonly finance: HistoricalFinanceInventoryResult;
  readonly storage?: StorageInventoryAggregateSummary;
}

export type HistoricalFinanceInventoryReceipt = HistoricalFinanceInventoryResult | HistoricalFinanceInventoryCompositeReceipt;

export function createCoverageCounts(): Record<FinanceInventoryEntity, number> {
  return Object.fromEntries(FINANCE_INVENTORY_ENTITIES.map((entity) => [entity, 0])) as Record<FinanceInventoryEntity, number>;
}

export function createClassificationTotals(): Record<FinanceClassification, number> {
  return { SAFE: 0, LEGACY_SUPPORTED: 0, REPAIRABLE: 0, INVALID_BLOCKING: 0 };
}

export function resolveInventoryStatus(
  totals: Readonly<Record<FinanceClassification, number>>,
  findingsTruncated: boolean,
  operationalErrorCode?: HistoricalFinanceInventoryResult['operationalErrorCode'],
): HistoricalFinanceInventoryStatus {
  if (operationalErrorCode !== undefined) {
    return 'INCOMPLETE_OPERATIONAL_ERROR';
  }
  if (findingsTruncated || totals.INVALID_BLOCKING > 0) {
    return 'COMPLETE_WITH_BLOCKING_FINDINGS';
  }
  if (totals.LEGACY_SUPPORTED > 0 || totals.REPAIRABLE > 0) {
    return 'COMPLETE_WITH_FINDINGS';
  }
  return 'COMPLETE_CLEAN';
}

export function redactionMetadata(): HistoricalFinanceInventoryResult['redaction'] {
  return {
    tenantIdentifiers: 'excluded',
    recordIdentifiers: 'excluded',
    amounts: 'excluded',
    cursors: 'excluded',
    rawPayloads: 'excluded',
    stackTraces: 'excluded',
  };
}

/** Redacts the existing historical storage receipt to stable aggregate counts. */
export function summarizeHistoricalStorageInventoryReceipt(
  receipt: HistoricalInventoryReceipt,
): StorageInventoryAggregateSummary {
  const counts: Record<string, number> = {
    databaseRowsScanned: receipt.databaseRowsScanned,
    databaseReferencesScanned: receipt.databaseReferencesScanned,
    storageEntriesScanned: receipt.storageEntriesScanned,
    bucketsScanned: receipt.bucketsScanned,
    operationalErrorCount: receipt.operationalErrorCount,
  };
  for (const [outcome, count] of Object.entries(receipt.referenceOutcomeCounts)) {
    counts[`reference:${outcome}`] = count;
  }
  for (const [outcome, count] of Object.entries(receipt.storageOutcomeCounts)) {
    counts[`storage:${outcome}`] = count;
  }
  for (const [disposition, count] of Object.entries(receipt.dispositionCounts)) {
    counts[`disposition:${disposition}`] = count;
  }

  return { status: receipt.scanStatus, counts };
}

/** Creates the redacted result for a requested storage scan that could not run. */
export function storageOperationalFailureSummary(): StorageInventoryAggregateSummary {
  return {
    status: 'INCOMPLETE_OPERATIONAL_ERROR',
    counts: {},
    operationalErrorCode: 'STORAGE_SCAN_FAILED',
  };
}

/** Keeps independently produced storage aggregates separate from finance output. */
export function composeFinanceAndStorageSummaries(
  finance: HistoricalFinanceInventoryResult,
  storage?: StorageInventoryAggregateSummary,
): HistoricalFinanceInventoryCompositeReceipt {
  return storage === undefined ? { finance } : { finance, storage };
}

export type { FinanceFindingCategory };
