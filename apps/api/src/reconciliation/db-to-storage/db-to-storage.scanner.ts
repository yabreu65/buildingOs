import { classifyProviderError, isConclusiveNotFoundError } from './db-to-storage.errors';
import {
  classifyExpenseAttachmentReference,
  classifyFileReference,
  classifyIncomeAttachmentReference,
  classifyImportNormalizedReference,
  classifyImportOriginalReference,
  redactObjectReference,
} from './db-to-storage.classifier';
import {
  ClassificationDecision,
  DetailedFinding,
  ExpenseReferenceRecord,
  FileReferenceRecord,
  IdentityClass,
  IncomeReferenceRecord,
  ImportJobReferenceRecord,
  ReadOnlyReconciliationDatabase,
  ReferenceSource,
  ScanReceipt,
  ScanSource,
  ScannerOptions,
  SourceCounts,
  StorageObservation,
  StorageStatClient,
} from './db-to-storage.types';

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_FINDINGS = 1000;

function createIdentityCounts(): Record<IdentityClass, number> {
  return {
    EXACT_VERSIONED: 0,
    LEGACY_OR_UNKNOWN: 0,
    LEGACY_KEY_ONLY: 0,
    CONTRACT_VIOLATION: 0,
    INVALID_REFERENCE: 0,
    NOT_APPLICABLE: 0,
    KEY_ONLY_UNVERSIONED: 0,
  };
}

function createObservationCounts(): Record<StorageObservation, number> {
  return {
    EXACT_PRESENT: 0,
    EXACT_MISSING: 0,
    CURRENT_PRESENT: 0,
    CURRENT_MISSING: 0,
    NOT_CHECKED: 0,
    OPERATIONAL_ERROR: 0,
  };
}

function createSourceCounts(): SourceCounts {
  return {
    recordsScanned: 0,
    classificationCounts: createIdentityCounts(),
    storageObservationCounts: createObservationCounts(),
    findingsCount: 0,
  };
}

interface MutableScanState {
  readonly classificationCounts: Record<IdentityClass, number>;
  readonly storageObservationCounts: Record<StorageObservation, number>;
  readonly sourceCounts: Record<ReferenceSource, SourceCounts>;
  readonly detailedFindings: DetailedFinding[];
  readonly maxFindings: number;
  databaseFileRows: number;
  databaseImportRows: number;
  databaseExpenseRows: number;
  databaseIncomeRows: number;
  recordsScanned: number;
  findingsCount: number;
  operationalErrorCount: number;
}

function createState(maxFindings: number): MutableScanState {
  return {
    classificationCounts: createIdentityCounts(),
    storageObservationCounts: createObservationCounts(),
    sourceCounts: {
      File: createSourceCounts(),
      'ImportJob.original': createSourceCounts(),
      'ImportJob.normalized': createSourceCounts(),
      'Expense.attachment': createSourceCounts(),
      'Income.attachment': createSourceCounts(),
    },
    detailedFindings: [],
    maxFindings,
    databaseFileRows: 0,
    databaseImportRows: 0,
    databaseExpenseRows: 0,
    databaseIncomeRows: 0,
    recordsScanned: 0,
    findingsCount: 0,
    operationalErrorCount: 0,
  };
}

function normalizePositiveInteger(value: number | undefined, fallback: number, allowZero = false): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`Scanner option must be an integer >= ${allowZero ? 0 : 1}`);
  }

  return value;
}

export class DbToStorageScanner {
  private readonly batchSize: number;
  private readonly maxFindings: number;

  constructor(
    private readonly database: ReadOnlyReconciliationDatabase,
    private readonly storage: StorageStatClient,
    options: ScannerOptions = {},
  ) {
    this.batchSize = normalizePositiveInteger(options.batchSize, DEFAULT_BATCH_SIZE);
    this.maxFindings = normalizePositiveInteger(options.maxFindings, DEFAULT_MAX_FINDINGS, true);
  }

  async scan(): Promise<ScanReceipt> {
    const startedAt = new Date().toISOString();
    const state = createState(this.maxFindings);

    try {
      await this.scanFiles(state);
    } catch (error) {
      this.recordDatabaseError(state, 'File', error);
    }

    try {
      await this.scanImportJobs(state);
    } catch (error) {
      this.recordDatabaseError(state, 'ImportJob.original', error);
    }

    try {
      await this.scanExpenses(state);
    } catch (error) {
      this.recordDatabaseError(state, 'Expense.attachment', error);
    }

    try {
      await this.scanIncomes(state);
    } catch (error) {
      this.recordDatabaseError(state, 'Income.attachment', error);
    }

    const completedAt = new Date().toISOString();
    const scanStatus = state.operationalErrorCount > 0
      ? 'INCOMPLETE_OPERATIONAL_ERROR'
      : state.findingsCount > 0
        ? 'COMPLETE_WITH_FINDINGS'
        : 'COMPLETE_CLEAN';

    return {
      schemaVersion: '1.0',
      scannerName: 'db-to-storage-object-reference',
      startedAt,
      completedAt,
      consistencyModel: 'MOVING_WINDOW',
      databaseReferenceCounts: {
        File: state.databaseFileRows,
        ImportJob: state.databaseImportRows,
        Expense: state.databaseExpenseRows,
        Income: state.databaseIncomeRows,
        totalDatabaseRows: state.databaseFileRows
          + state.databaseImportRows
          + state.databaseExpenseRows
          + state.databaseIncomeRows,
        totalReferences: state.recordsScanned,
      },
      classificationCounts: state.classificationCounts,
      storageObservationCounts: state.storageObservationCounts,
      sourceCounts: state.sourceCounts,
      operationalErrorCount: state.operationalErrorCount,
      exactMissingCount: state.storageObservationCounts.EXACT_MISSING,
      currentMissingCount: state.storageObservationCounts.CURRENT_MISSING,
      contractViolationCount: state.classificationCounts.CONTRACT_VIOLATION,
      invalidReferenceCount: state.classificationCounts.INVALID_REFERENCE,
      legacyCount: state.classificationCounts.LEGACY_OR_UNKNOWN + state.classificationCounts.LEGACY_KEY_ONLY,
      notApplicableCount: state.classificationCounts.NOT_APPLICABLE,
      recordsScanned: state.recordsScanned,
      scanStatus,
      detailedFindings: state.detailedFindings,
    };
  }

  private async scanFiles(state: MutableScanState): Promise<void> {
    await this.scanBatches(
      (afterId) => this.database.findFileBatch({ afterId, take: this.batchSize }),
      (row) => {
        state.databaseFileRows += 1;
        return this.inspectReference(
          state,
          'File',
          row,
          classifyFileReference(row.tenantId, row.bucket, row.objectKey, row.objectVersionId),
          row.bucket,
          row.objectKey,
          row.objectVersionId,
        );
      },
    );
  }

  private async scanImportJobs(state: MutableScanState): Promise<void> {
    await this.scanBatches(
      (afterId) => this.database.findImportJobBatch({ afterId, take: this.batchSize }),
      async (row) => {
        state.databaseImportRows += 1;
        await this.inspectReference(
          state,
          'ImportJob.original',
          row,
          classifyImportOriginalReference(
            row.tenantId,
            row.previewVersion,
            row.originalObjectKey,
            row.originalObjectVersionId,
          ),
          this.storage.getDefaultBucket(),
          row.originalObjectKey,
          row.originalObjectVersionId,
        );
        await this.inspectReference(
          state,
          'ImportJob.normalized',
          row,
          classifyImportNormalizedReference(
            row.tenantId,
            row.previewVersion,
            row.status,
            row.normalizedObjectKey,
            row.normalizedObjectVersionId,
          ),
          this.storage.getDefaultBucket(),
          row.normalizedObjectKey,
          row.normalizedObjectVersionId,
        );
      },
    );
  }

  private async scanExpenses(state: MutableScanState): Promise<void> {
    await this.scanBatches(
      (afterId) => this.database.findExpenseBatch({ afterId, take: this.batchSize }),
      (row) => {
        state.databaseExpenseRows += 1;
        return this.inspectReference(
          state,
          'Expense.attachment',
          row,
          classifyExpenseAttachmentReference(row.attachmentFileKey),
          null,
          row.attachmentFileKey,
          null,
        );
      },
    );
  }

  private async scanIncomes(state: MutableScanState): Promise<void> {
    await this.scanBatches(
      (afterId) => this.database.findIncomeBatch({ afterId, take: this.batchSize }),
      (row) => {
        state.databaseIncomeRows += 1;
        return this.inspectReference(
          state,
          'Income.attachment',
          row,
          classifyIncomeAttachmentReference(row.attachmentFileKey),
          null,
          row.attachmentFileKey,
          null,
        );
      },
    );
  }

  private async scanBatches<T extends { id: string }>(
    fetchBatch: (afterId: string | undefined) => Promise<readonly T[]>,
    inspectBatch: (row: T) => Promise<void> | void,
  ): Promise<void> {
    let afterId: string | undefined;

    while (true) {
      const batch = await fetchBatch(afterId);
      if (batch.length === 0) {
        return;
      }

      for (const row of batch) {
        await inspectBatch(row);
      }

      const nextAfterId = batch[batch.length - 1]?.id;
      if (!nextAfterId || nextAfterId === afterId) {
        throw new Error('Database pagination did not advance');
      }

      afterId = nextAfterId;
    }
  }

  private async inspectReference(
    state: MutableScanState,
    source: ReferenceSource,
    record: FileReferenceRecord | ImportJobReferenceRecord | ExpenseReferenceRecord | IncomeReferenceRecord,
    decision: ClassificationDecision,
    bucket: string | null,
    objectKey: string | null,
    objectVersionId: string | null,
  ): Promise<void> {
    state.recordsScanned += 1;
    const sourceCounts = state.sourceCounts[source];
    sourceCounts.recordsScanned += 1;
    state.classificationCounts[decision.identityClass] += 1;
    sourceCounts.classificationCounts[decision.identityClass] += 1;

    const observation = await this.observeStorage(decision, bucket, objectKey, objectVersionId, state);
    state.storageObservationCounts[observation.value] += 1;
    sourceCounts.storageObservationCounts[observation.value] += 1;

    const finding = this.createFinding(record, source, bucket, objectKey, decision, observation.value, observation.errorCategory);
    if (!finding) {
      return;
    }

    state.findingsCount += 1;
    sourceCounts.findingsCount += 1;
    if (state.detailedFindings.length < state.maxFindings) {
      state.detailedFindings.push(finding);
    }
  }

  private async observeStorage(
    decision: ClassificationDecision,
    bucket: string | null,
    objectKey: string | null,
    objectVersionId: string | null,
    state: MutableScanState,
  ): Promise<{ value: StorageObservation; errorCategory?: ReturnType<typeof classifyProviderError> }> {
    if (decision.storageCheck === 'NONE' || bucket === null || objectKey === null || objectVersionId === null && decision.storageCheck === 'EXACT') {
      return { value: 'NOT_CHECKED' };
    }

    try {
      if (decision.storageCheck === 'EXACT') {
        await this.storage.statObject(bucket, objectKey, objectVersionId ?? undefined);
        return { value: 'EXACT_PRESENT' };
      }

      await this.storage.statObject(bucket, objectKey);
      return { value: 'CURRENT_PRESENT' };
    } catch (error) {
      if (isConclusiveNotFoundError(error)) {
        return { value: decision.storageCheck === 'EXACT' ? 'EXACT_MISSING' : 'CURRENT_MISSING' };
      }

      state.operationalErrorCount += 1;
      return {
        value: 'OPERATIONAL_ERROR',
        errorCategory: classifyProviderError(error),
      };
    }
  }

  private createFinding(
    record: FileReferenceRecord | ImportJobReferenceRecord | ExpenseReferenceRecord | IncomeReferenceRecord,
    source: ReferenceSource,
    bucket: string | null,
    objectKey: string | null,
    decision: ClassificationDecision,
    observation: StorageObservation,
    providerErrorCategory?: ReturnType<typeof classifyProviderError>,
  ): DetailedFinding | null {
    const isLegacy = decision.identityClass === 'LEGACY_OR_UNKNOWN' || decision.identityClass === 'LEGACY_KEY_ONLY';
    const isFinding = isLegacy
      || decision.identityClass === 'KEY_ONLY_UNVERSIONED'
      || decision.identityClass === 'CONTRACT_VIOLATION'
      || decision.identityClass === 'INVALID_REFERENCE'
      || observation === 'EXACT_MISSING'
      || observation === 'CURRENT_MISSING'
      || observation === 'OPERATIONAL_ERROR';

    if (!isFinding) {
      return null;
    }

    return {
      source,
      databaseId: record.id,
      tenantId: record.tenantId,
      ...(bucket ? { bucket } : {}),
      ...(objectKey !== null ? { objectReference: redactObjectReference(objectKey) } : {}),
      identityClass: decision.identityClass,
      storageObservation: observation,
      ...(providerErrorCategory ? { providerErrorCategory } : {}),
    };
  }

  private recordDatabaseError(state: MutableScanState, source: ScanSource, error: unknown): void {
    state.operationalErrorCount += 1;
    state.findingsCount += 1;
    if (state.detailedFindings.length < state.maxFindings) {
      state.detailedFindings.push({
        source,
        providerErrorCategory: classifyProviderError(error),
      });
    }
  }
}
