import {
  ProviderErrorCategory,
  ReadOnlyReconciliationDatabase,
  ReferenceSource,
} from '../db-to-storage/db-to-storage.types';

export const HISTORICAL_REFERENCE_OUTCOMES = [
  'EXACT_REFERENCED_VERSION_PRESENT',
  'EXACT_REFERENCED_VERSION_MISSING',
  'LEGACY_KEY_ONLY_REFERENCE',
  'INVALID_REFERENCE',
  'CROSS_TENANT_REFERENCE',
  'PROVIDER_OPERATIONAL_ERROR',
] as const;

export type HistoricalReferenceOutcome = (typeof HISTORICAL_REFERENCE_OUTCOMES)[number];

export const HISTORICAL_STORAGE_OUTCOMES = [
  'CURRENT_OBJECT',
  'NONCURRENT_VERSION',
  'LATEST_DELETE_MARKER',
  'NONCURRENT_DELETE_MARKER',
  'CURRENT_ORPHAN_OBJECT',
  'ORPHAN_HISTORICAL_VERSION',
] as const;

export type HistoricalStorageOutcome = (typeof HISTORICAL_STORAGE_OUTCOMES)[number];
export type HistoricalInventoryOutcome = HistoricalReferenceOutcome | HistoricalStorageOutcome;
export type HistoricalDisposition = 'NONE' | 'PRESERVE' | 'REPAIR_REQUIRED_LATER' | 'OPERATIONAL_ERROR';
export type HistoricalScanStatus = 'COMPLETE_CLEAN' | 'COMPLETE_WITH_FINDINGS' | 'INCOMPLETE_OPERATIONAL_ERROR';

export interface HistoricalObjectVersion {
  readonly objectKey: string;
  readonly versionId: string;
  readonly isLatest: boolean;
  readonly isDeleteMarker: boolean;
  readonly size?: number;
}

export interface HistoricalListingOptions {
  readonly prefix: string;
  readonly maxKeys: number;
  readonly keyMarker?: string;
  readonly versionIdMarker?: string;
}

export interface HistoricalObjectVersionPage {
  readonly items: readonly HistoricalObjectVersion[];
  readonly isTruncated: boolean;
  readonly nextKeyMarker?: string;
  readonly nextVersionIdMarker?: string;
}

/** Read-only storage surface intentionally excludes every mutation and object-body API. */
export interface HistoricalInventoryStorage {
  getDefaultBucket(): string;
  listObjectVersionsPage(
    bucketName: string,
    options: HistoricalListingOptions,
  ): Promise<HistoricalObjectVersionPage>;
}

export interface HistoricalInventoryFinding {
  readonly source: ReferenceSource | 'DATABASE' | 'STORAGE';
  readonly outcome: HistoricalInventoryOutcome;
  readonly disposition: HistoricalDisposition;
  readonly objectReference?: string;
  readonly versionReference?: string;
  readonly providerErrorCategory?: ProviderErrorCategory;
}

export interface HistoricalInventoryReceipt {
  readonly schemaVersion: '1.0';
  readonly scannerName: 'historical-object-inventory';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly consistencyModel: 'MOVING_WINDOW';
  readonly databaseRowsScanned: number;
  readonly databaseReferencesScanned: number;
  readonly storageEntriesScanned: number;
  readonly bucketsScanned: number;
  readonly referenceOutcomeCounts: Record<HistoricalReferenceOutcome, number>;
  readonly storageOutcomeCounts: Record<HistoricalStorageOutcome, number>;
  readonly dispositionCounts: Record<Exclude<HistoricalDisposition, 'NONE'>, number>;
  readonly operationalErrorCount: number;
  readonly scanStatus: HistoricalScanStatus;
  readonly detailedFindings: readonly HistoricalInventoryFinding[];
}

export interface HistoricalInventoryScannerOptions {
  readonly databaseBatchSize?: number;
  readonly storagePageSize?: number;
  readonly maxFindings?: number;
}

export type HistoricalInventoryDatabase = ReadOnlyReconciliationDatabase;
