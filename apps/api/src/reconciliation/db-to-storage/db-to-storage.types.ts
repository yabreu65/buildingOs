import { ImportJobStatus } from '@prisma/client';

export const IDENTITY_CLASSES = [
  'EXACT_VERSIONED',
  'LEGACY_OR_UNKNOWN',
  'LEGACY_KEY_ONLY',
  'CONTRACT_VIOLATION',
  'INVALID_REFERENCE',
  'NOT_APPLICABLE',
  'KEY_ONLY_UNVERSIONED',
] as const;

export type IdentityClass = (typeof IDENTITY_CLASSES)[number];

export const STORAGE_OBSERVATIONS = [
  'EXACT_PRESENT',
  'EXACT_MISSING',
  'CURRENT_PRESENT',
  'CURRENT_MISSING',
  'NOT_CHECKED',
  'OPERATIONAL_ERROR',
] as const;

export type StorageObservation = (typeof STORAGE_OBSERVATIONS)[number];

export const REFERENCE_SOURCES = [
  'File',
  'ImportJob.original',
  'ImportJob.normalized',
  'Expense.attachment',
  'Income.attachment',
] as const;

export type ReferenceSource = (typeof REFERENCE_SOURCES)[number];
export type ScanSource = ReferenceSource | 'DATABASE';
export type StorageCheck = 'EXACT' | 'CURRENT' | 'NONE';

export interface ClassificationDecision {
  readonly identityClass: IdentityClass;
  readonly storageCheck: StorageCheck;
}

export interface FileReferenceRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly bucket: string | null;
  readonly objectKey: string | null;
  readonly objectVersionId: string | null;
}

export interface ImportJobReferenceRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly status: ImportJobStatus;
  readonly previewVersion: number;
  readonly originalObjectKey: string | null;
  readonly originalObjectVersionId: string | null;
  readonly normalizedObjectKey: string | null;
  readonly normalizedObjectVersionId: string | null;
}

export interface ExpenseReferenceRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly attachmentFileKey: string | null;
}

export interface IncomeReferenceRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly attachmentFileKey: string | null;
}

export interface DatabaseBatchOptions {
  readonly afterId?: string;
  readonly take: number;
}

export interface ReadOnlyReconciliationDatabase {
  findFileBatch(options: DatabaseBatchOptions): Promise<readonly FileReferenceRecord[]>;
  findImportJobBatch(options: DatabaseBatchOptions): Promise<readonly ImportJobReferenceRecord[]>;
  findExpenseBatch(options: DatabaseBatchOptions): Promise<readonly ExpenseReferenceRecord[]>;
  findIncomeBatch(options: DatabaseBatchOptions): Promise<readonly IncomeReferenceRecord[]>;
}

export interface StorageStatClient {
  getDefaultBucket(): string;
  statObject(bucket: string, objectKey: string, versionId?: string): Promise<unknown>;
}

export type ProviderErrorCategory =
  | 'AUTHORIZATION'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'SERVER_ERROR'
  | 'PROVIDER_ERROR';

export interface DetailedFinding {
  readonly source: ScanSource;
  readonly databaseId?: string;
  readonly tenantId?: string;
  readonly bucket?: string;
  readonly objectReference?: string;
  readonly identityClass?: IdentityClass;
  readonly storageObservation?: StorageObservation;
  readonly providerErrorCategory?: ProviderErrorCategory;
}

export interface SourceCounts {
  recordsScanned: number;
  classificationCounts: Record<IdentityClass, number>;
  storageObservationCounts: Record<StorageObservation, number>;
  findingsCount: number;
}

export interface ScanReceipt {
  readonly schemaVersion: '1.0';
  readonly scannerName: 'db-to-storage-object-reference';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly consistencyModel: 'MOVING_WINDOW';
  readonly databaseReferenceCounts: {
    readonly File: number;
    readonly ImportJob: number;
    readonly Expense: number;
    readonly Income: number;
    readonly totalDatabaseRows: number;
    readonly totalReferences: number;
  };
  readonly classificationCounts: Record<IdentityClass, number>;
  readonly storageObservationCounts: Record<StorageObservation, number>;
  readonly sourceCounts: Record<ReferenceSource, SourceCounts>;
  readonly operationalErrorCount: number;
  readonly exactMissingCount: number;
  readonly currentMissingCount: number;
  readonly contractViolationCount: number;
  readonly invalidReferenceCount: number;
  readonly legacyCount: number;
  readonly notApplicableCount: number;
  readonly recordsScanned: number;
  readonly scanStatus: ScanStatus;
  readonly detailedFindings: readonly DetailedFinding[];
}

export type ScanStatus = 'COMPLETE_CLEAN' | 'COMPLETE_WITH_FINDINGS' | 'INCOMPLETE_OPERATIONAL_ERROR';

export interface ScannerOptions {
  readonly batchSize?: number;
  readonly maxFindings?: number;
}
