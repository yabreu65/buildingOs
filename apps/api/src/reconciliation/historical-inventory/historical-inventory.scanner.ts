import {
  classifyExpenseAttachmentReference,
  classifyFileReference,
  classifyImportNormalizedReference,
  classifyImportOriginalReference,
  classifyIncomeAttachmentReference,
  redactObjectReference,
} from '../db-to-storage/db-to-storage.classifier';
import { classifyProviderError } from '../db-to-storage/db-to-storage.errors';
import {
  ClassificationDecision,
  ExpenseReferenceRecord,
  FileReferenceRecord,
  ImportJobReferenceRecord,
  IncomeReferenceRecord,
  ReferenceSource,
} from '../db-to-storage/db-to-storage.types';
import {
  HISTORICAL_REFERENCE_OUTCOMES,
  HISTORICAL_STORAGE_OUTCOMES,
  HistoricalDisposition,
  HistoricalInventoryDatabase,
  HistoricalInventoryFinding,
  HistoricalInventoryReceipt,
  HistoricalInventoryScannerOptions,
  HistoricalInventoryStorage,
  HistoricalObjectVersion,
  HistoricalObjectVersionPage,
  HistoricalReferenceOutcome,
  HistoricalStorageOutcome,
} from './historical-inventory.types';

const DEFAULT_DATABASE_BATCH_SIZE = 100;
const DEFAULT_STORAGE_PAGE_SIZE = 100;
const DEFAULT_MAX_FINDINGS = 1000;
const TENANT_NAMESPACES = ['tenant-imports/', 'pilot-data-pack/', 'tenant/', 'tenant-'] as const;

interface ValidatedReference {
  readonly source: ReferenceSource;
  readonly bucket: string;
  readonly objectKey: string;
  readonly versionId?: string;
}

interface HistoricalObjectVersionPageLike {
  readonly items?: unknown;
  readonly isTruncated?: unknown;
  readonly nextKeyMarker?: unknown;
  readonly nextVersionIdMarker?: unknown;
}

interface HistoricalObjectVersionLike {
  readonly objectKey?: unknown;
  readonly versionId?: unknown;
  readonly isLatest?: unknown;
  readonly isDeleteMarker?: unknown;
  readonly size?: unknown;
}

interface MutableState {
  readonly exactReferences: ValidatedReference[];
  readonly exactIdentities: Set<string>;
  readonly legacyKeys: Set<string>;
  readonly buckets: Set<string>;
  readonly successfullyListedBuckets: Set<string>;
  readonly foundExactIdentities: Set<string>;
  readonly referenceOutcomeCounts: Record<HistoricalReferenceOutcome, number>;
  readonly storageOutcomeCounts: Record<HistoricalStorageOutcome, number>;
  readonly dispositionCounts: Record<Exclude<HistoricalDisposition, 'NONE'>, number>;
  readonly detailedFindings: HistoricalInventoryFinding[];
  databaseRowsScanned: number;
  databaseReferencesScanned: number;
  storageEntriesScanned: number;
  operationalErrorCount: number;
  findingsCount: number;
  databaseComplete: boolean;
}

function createReferenceCounts(): Record<HistoricalReferenceOutcome, number> {
  return Object.fromEntries(HISTORICAL_REFERENCE_OUTCOMES.map((outcome) => [outcome, 0])) as Record<HistoricalReferenceOutcome, number>;
}

function createStorageCounts(): Record<HistoricalStorageOutcome, number> {
  return Object.fromEntries(HISTORICAL_STORAGE_OUTCOMES.map((outcome) => [outcome, 0])) as Record<HistoricalStorageOutcome, number>;
}

function createState(defaultBucket: string): MutableState {
  return {
    exactReferences: [],
    exactIdentities: new Set<string>(),
    legacyKeys: new Set<string>(),
    buckets: new Set<string>([defaultBucket]),
    successfullyListedBuckets: new Set<string>(),
    foundExactIdentities: new Set<string>(),
    referenceOutcomeCounts: createReferenceCounts(),
    storageOutcomeCounts: createStorageCounts(),
    dispositionCounts: {
      PRESERVE: 0,
      REPAIR_REQUIRED_LATER: 0,
      OPERATIONAL_ERROR: 0,
    },
    detailedFindings: [],
    databaseRowsScanned: 0,
    databaseReferencesScanned: 0,
    storageEntriesScanned: 0,
    operationalErrorCount: 0,
    findingsCount: 0,
    databaseComplete: true,
  };
}

function identityKey(bucket: string, objectKey: string, versionId: string): string {
  return JSON.stringify([bucket, objectKey, versionId]);
}

function objectKey(bucket: string, key: string): string {
  return JSON.stringify([bucket, key]);
}

function redactVersionReference(versionId: string | undefined): string | undefined {
  return versionId === undefined ? undefined : `[redacted-version:length-${versionId.length}]`;
}

function isValidBucketName(bucket: string): boolean {
  return bucket.length >= 3
    && bucket.length <= 63
    && /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/u.test(bucket)
    && !bucket.includes('..')
    && !bucket.includes('.-')
    && !bucket.includes('-.');
}

function tenantFromRecognizedKey(key: string): string | undefined {
  const namespace = TENANT_NAMESPACES.find((candidate) => key.startsWith(candidate));
  if (!namespace) {
    return undefined;
  }

  const remainder = key.slice(namespace.length);
  const slashIndex = remainder.indexOf('/');
  if (slashIndex <= 0 || slashIndex === remainder.length - 1) {
    return undefined;
  }

  return remainder.slice(0, slashIndex);
}

function isCrossTenantReference(tenantId: string, key: string | null): boolean {
  if (typeof key !== 'string' || tenantId.trim().length === 0) {
    return false;
  }

  const keyTenant = tenantFromRecognizedKey(key);
  return keyTenant !== undefined && keyTenant !== tenantId;
}

function isHistoricalObjectVersionShape(value: unknown): value is HistoricalObjectVersion {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const entry = value as HistoricalObjectVersionLike;
  return typeof entry.objectKey === 'string'
    && entry.objectKey.trim().length > 0
    && typeof entry.versionId === 'string'
    && entry.versionId.trim().length > 0
    && typeof entry.isLatest === 'boolean'
    && typeof entry.isDeleteMarker === 'boolean'
    && (entry.size === undefined || typeof entry.size === 'number' && Number.isFinite(entry.size) && entry.size >= 0);
}

function isHistoricalObjectVersionPage(
  value: unknown,
  maximumEntries: number,
): value is HistoricalObjectVersionPage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const page = value as HistoricalObjectVersionPageLike;
  return Array.isArray(page.items)
    && page.items.length <= maximumEntries
    && page.items.every(isHistoricalObjectVersionShape)
    && typeof page.isTruncated === 'boolean'
    && (page.nextKeyMarker === undefined || typeof page.nextKeyMarker === 'string')
    && (page.nextVersionIdMarker === undefined || typeof page.nextVersionIdMarker === 'string');
}

function normalizeInteger(
  value: number | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum?: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < minimum || maximum !== undefined && value > maximum) {
    const range = maximum === undefined ? `at least ${minimum}` : `between ${minimum} and ${maximum}`;
    throw new Error(`${name} must be an integer ${range}`);
  }

  return value;
}

/**
 * Produces a read-only moving-window inventory of database references and all
 * provider-visible object versions. It never reads object bodies or mutates
 * database/storage state.
 */
export class HistoricalInventoryScanner {
  private readonly databaseBatchSize: number;
  private readonly storagePageSize: number;
  private readonly maxFindings: number;

  constructor(
    private readonly database: HistoricalInventoryDatabase,
    private readonly storage: HistoricalInventoryStorage,
    options: HistoricalInventoryScannerOptions = {},
  ) {
    this.databaseBatchSize = normalizeInteger(
      options.databaseBatchSize,
      DEFAULT_DATABASE_BATCH_SIZE,
      'databaseBatchSize',
      1,
    );
    this.storagePageSize = normalizeInteger(
      options.storagePageSize,
      DEFAULT_STORAGE_PAGE_SIZE,
      'storagePageSize',
      1,
      1000,
    );
    this.maxFindings = normalizeInteger(options.maxFindings, DEFAULT_MAX_FINDINGS, 'maxFindings', 0);
  }

  async scan(): Promise<HistoricalInventoryReceipt> {
    const startedAt = new Date().toISOString();
    const state = createState(this.storage.getDefaultBucket());

    await this.scanDatabase(state);
    await this.scanStorage(state);
    this.finishExactReferenceCorrelation(state);

    const scanStatus = state.operationalErrorCount > 0
      ? 'INCOMPLETE_OPERATIONAL_ERROR'
      : state.findingsCount > 0
        ? 'COMPLETE_WITH_FINDINGS'
        : 'COMPLETE_CLEAN';

    return {
      schemaVersion: '1.0',
      scannerName: 'historical-object-inventory',
      startedAt,
      completedAt: new Date().toISOString(),
      consistencyModel: 'MOVING_WINDOW',
      databaseRowsScanned: state.databaseRowsScanned,
      databaseReferencesScanned: state.databaseReferencesScanned,
      storageEntriesScanned: state.storageEntriesScanned,
      bucketsScanned: state.successfullyListedBuckets.size,
      referenceOutcomeCounts: state.referenceOutcomeCounts,
      storageOutcomeCounts: state.storageOutcomeCounts,
      dispositionCounts: state.dispositionCounts,
      operationalErrorCount: state.operationalErrorCount,
      scanStatus,
      detailedFindings: state.detailedFindings,
    };
  }

  private async scanDatabase(state: MutableState): Promise<void> {
    await this.scanDatabaseSource(
      state,
      () => this.scanBatches(
        (afterId) => this.database.findFileBatch({ afterId, take: this.databaseBatchSize }),
        (row) => {
          state.databaseRowsScanned += 1;
          this.inspectFileReference(state, row);
        },
      ),
    );
    await this.scanDatabaseSource(
      state,
      () => this.scanBatches(
        (afterId) => this.database.findImportJobBatch({ afterId, take: this.databaseBatchSize }),
        (row) => {
          state.databaseRowsScanned += 1;
          this.inspectImportReferences(state, row);
        },
      ),
    );
    await this.scanDatabaseSource(
      state,
      () => this.scanBatches(
        (afterId) => this.database.findExpenseBatch({ afterId, take: this.databaseBatchSize }),
        (row) => {
          state.databaseRowsScanned += 1;
          this.inspectAttachmentReference(
            state,
            'Expense.attachment',
            row,
            classifyExpenseAttachmentReference(row.tenantId, row.attachmentFileKey),
          );
        },
      ),
    );
    await this.scanDatabaseSource(
      state,
      () => this.scanBatches(
        (afterId) => this.database.findIncomeBatch({ afterId, take: this.databaseBatchSize }),
        (row) => {
          state.databaseRowsScanned += 1;
          this.inspectAttachmentReference(
            state,
            'Income.attachment',
            row,
            classifyIncomeAttachmentReference(row.tenantId, row.attachmentFileKey),
          );
        },
      ),
    );
  }

  private async scanDatabaseSource(state: MutableState, operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error: unknown) {
      state.databaseComplete = false;
      this.recordOperationalError(state, 'DATABASE', error);
    }
  }

  private async scanBatches<T extends { readonly id: string }>(
    fetchBatch: (afterId: string | undefined) => Promise<readonly T[]>,
    inspect: (row: T) => void,
  ): Promise<void> {
    let afterId: string | undefined;

    while (true) {
      const batch = await fetchBatch(afterId);
      if (batch.length === 0) {
        return;
      }

      batch.forEach(inspect);
      const nextAfterId = batch[batch.length - 1]?.id;
      if (!nextAfterId || nextAfterId === afterId) {
        throw new Error('Database pagination did not advance');
      }
      afterId = nextAfterId;
    }
  }

  private inspectFileReference(state: MutableState, row: FileReferenceRecord): void {
    const decision = classifyFileReference(row.tenantId, row.bucket, row.objectKey, row.objectVersionId);
    this.inspectReference(
      state,
      'File',
      row.tenantId,
      row.bucket,
      row.objectKey,
      row.objectVersionId,
      decision,
    );
  }

  private inspectImportReferences(state: MutableState, row: ImportJobReferenceRecord): void {
    const bucket = this.storage.getDefaultBucket();
    this.inspectReference(
      state,
      'ImportJob.original',
      row.tenantId,
      bucket,
      row.originalObjectKey,
      row.originalObjectVersionId,
      classifyImportOriginalReference(
        row.tenantId,
        row.previewVersion,
        row.originalObjectKey,
        row.originalObjectVersionId,
      ),
    );
    this.inspectReference(
      state,
      'ImportJob.normalized',
      row.tenantId,
      bucket,
      row.normalizedObjectKey,
      row.normalizedObjectVersionId,
      classifyImportNormalizedReference(
        row.tenantId,
        row.previewVersion,
        row.status,
        row.normalizedObjectKey,
        row.normalizedObjectVersionId,
      ),
    );
  }

  private inspectAttachmentReference(
    state: MutableState,
    source: 'Expense.attachment' | 'Income.attachment',
    row: ExpenseReferenceRecord | IncomeReferenceRecord,
    decision: ClassificationDecision,
  ): void {
    this.inspectReference(
      state,
      source,
      row.tenantId,
      null,
      row.attachmentFileKey,
      null,
      decision,
    );
  }

  private inspectReference(
    state: MutableState,
    source: ReferenceSource,
    tenantId: string,
    bucket: string | null,
    key: string | null,
    versionId: string | null,
    decision: ClassificationDecision,
  ): void {
    if (decision.identityClass === 'NOT_APPLICABLE') {
      return;
    }

    state.databaseReferencesScanned += 1;
    if (isCrossTenantReference(tenantId, key)) {
      this.recordReferenceOutcome(state, source, 'CROSS_TENANT_REFERENCE', 'REPAIR_REQUIRED_LATER', key, versionId ?? undefined);
      return;
    }

    if (
      decision.identityClass === 'INVALID_REFERENCE'
      || decision.identityClass === 'CONTRACT_VIOLATION'
      || bucket !== null && !isValidBucketName(bucket)
    ) {
      this.recordReferenceOutcome(state, source, 'INVALID_REFERENCE', 'REPAIR_REQUIRED_LATER', key, versionId ?? undefined);
      return;
    }

    if (
      decision.identityClass === 'LEGACY_OR_UNKNOWN'
      || decision.identityClass === 'LEGACY_KEY_ONLY'
      || decision.identityClass === 'KEY_ONLY_UNVERSIONED'
    ) {
      this.recordReferenceOutcome(state, source, 'LEGACY_KEY_ONLY_REFERENCE', 'REPAIR_REQUIRED_LATER', key);
      if (decision.storageCheck === 'CURRENT' && bucket !== null && key !== null) {
        state.buckets.add(bucket);
        state.legacyKeys.add(objectKey(bucket, key));
      }
      return;
    }

    if (
      decision.identityClass === 'EXACT_VERSIONED'
      && bucket !== null
      && key !== null
      && versionId !== null
    ) {
      const reference = { source, bucket, objectKey: key, versionId };
      state.exactReferences.push(reference);
      state.exactIdentities.add(identityKey(bucket, key, versionId));
      state.buckets.add(bucket);
      return;
    }

    this.recordReferenceOutcome(state, source, 'INVALID_REFERENCE', 'REPAIR_REQUIRED_LATER', key, versionId ?? undefined);
  }

  private async scanStorage(state: MutableState): Promise<void> {
    const buckets = [...state.buckets].sort();
    for (const bucket of buckets) {
      try {
        const entries = await this.scanStorageBucket(bucket);
        entries.forEach((entry) => this.inspectStorageEntry(state, bucket, entry));
        state.successfullyListedBuckets.add(bucket);
      } catch (error: unknown) {
        this.recordOperationalError(state, 'STORAGE', error);
      }
    }
  }

  private async scanStorageBucket(bucket: string): Promise<HistoricalObjectVersion[]> {
    const entries: HistoricalObjectVersion[] = [];
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;

    while (true) {
      const page = await this.storage.listObjectVersionsPage(bucket, {
        prefix: '',
        maxKeys: this.storagePageSize,
        ...(keyMarker ? { keyMarker } : {}),
        ...(versionIdMarker ? { versionIdMarker } : {}),
      });
      if (!isHistoricalObjectVersionPage(page, this.storagePageSize)) {
        throw new Error('Historical storage listing returned an invalid page');
      }

      entries.push(...page.items);
      if (!page.isTruncated) {
        return entries;
      }

      const nextKeyMarker = page.nextKeyMarker;
      const nextVersionIdMarker = page.nextVersionIdMarker;
      if (
        !nextKeyMarker
        || !nextVersionIdMarker
        || nextKeyMarker === keyMarker && nextVersionIdMarker === versionIdMarker
      ) {
        throw new Error('Historical storage pagination did not advance');
      }

      keyMarker = nextKeyMarker;
      versionIdMarker = nextVersionIdMarker;
    }
  }

  private inspectStorageEntry(state: MutableState, bucket: string, entry: HistoricalObjectVersion): void {
    state.storageEntriesScanned += 1;
    const exactIdentity = identityKey(bucket, entry.objectKey, entry.versionId);
    const exactReferenced = state.exactIdentities.has(exactIdentity);
    const legacyReferenced = entry.isLatest && state.legacyKeys.has(objectKey(bucket, entry.objectKey));

    if (!entry.isDeleteMarker && exactReferenced) {
      state.foundExactIdentities.add(exactIdentity);
    }

    let outcome: HistoricalStorageOutcome;
    let disposition: HistoricalDisposition = 'NONE';
    if (entry.isDeleteMarker) {
      outcome = entry.isLatest ? 'LATEST_DELETE_MARKER' : 'NONCURRENT_DELETE_MARKER';
      disposition = 'PRESERVE';
    } else if (entry.isLatest) {
      if (exactReferenced || legacyReferenced || !state.databaseComplete) {
        outcome = 'CURRENT_OBJECT';
      } else {
        outcome = 'CURRENT_ORPHAN_OBJECT';
        disposition = 'PRESERVE';
      }
    } else if (exactReferenced || !state.databaseComplete) {
      outcome = 'NONCURRENT_VERSION';
    } else {
      outcome = 'ORPHAN_HISTORICAL_VERSION';
      disposition = 'PRESERVE';
    }

    this.recordStorageOutcome(state, outcome, disposition, entry.objectKey, entry.versionId);
  }

  private finishExactReferenceCorrelation(state: MutableState): void {
    if (!state.databaseComplete) {
      return;
    }

    for (const reference of state.exactReferences) {
      if (!state.successfullyListedBuckets.has(reference.bucket)) {
        continue;
      }

      const identity = identityKey(reference.bucket, reference.objectKey, reference.versionId ?? '');
      if (state.foundExactIdentities.has(identity)) {
        state.referenceOutcomeCounts.EXACT_REFERENCED_VERSION_PRESENT += 1;
      } else {
        this.recordReferenceOutcome(
          state,
          reference.source,
          'EXACT_REFERENCED_VERSION_MISSING',
          'REPAIR_REQUIRED_LATER',
          reference.objectKey,
          reference.versionId,
        );
      }
    }
  }

  private recordReferenceOutcome(
    state: MutableState,
    source: ReferenceSource,
    outcome: HistoricalReferenceOutcome,
    disposition: HistoricalDisposition,
    key?: string | null,
    versionId?: string,
  ): void {
    state.referenceOutcomeCounts[outcome] += 1;
    this.recordFinding(state, {
      source,
      outcome,
      disposition,
      ...(key !== undefined && key !== null ? { objectReference: redactObjectReference(key) } : {}),
      ...(redactVersionReference(versionId) ? { versionReference: redactVersionReference(versionId) } : {}),
    });
  }

  private recordStorageOutcome(
    state: MutableState,
    outcome: HistoricalStorageOutcome,
    disposition: HistoricalDisposition,
    key: string,
    versionId: string,
  ): void {
    state.storageOutcomeCounts[outcome] += 1;
    this.recordFinding(state, {
      source: 'STORAGE',
      outcome,
      disposition,
      objectReference: redactObjectReference(key),
      versionReference: redactVersionReference(versionId),
    });
  }

  private recordOperationalError(state: MutableState, source: 'DATABASE' | 'STORAGE', error: unknown): void {
    state.operationalErrorCount += 1;
    state.referenceOutcomeCounts.PROVIDER_OPERATIONAL_ERROR += 1;
    this.recordFinding(state, {
      source,
      outcome: 'PROVIDER_OPERATIONAL_ERROR',
      disposition: 'OPERATIONAL_ERROR',
      providerErrorCategory: classifyProviderError(error),
    });
  }

  private recordFinding(state: MutableState, finding: HistoricalInventoryFinding): void {
    if (finding.disposition === 'NONE') {
      return;
    }

    state.findingsCount += 1;
    state.dispositionCounts[finding.disposition] += 1;
    if (state.detailedFindings.length < this.maxFindings) {
      state.detailedFindings.push(finding);
    }
  }
}
