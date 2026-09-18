import {
  composeFinanceAndStorageSummaries,
  HistoricalFinanceInventoryReceipt,
  HistoricalFinanceInventoryResult,
  storageOperationalFailureSummary,
  StorageInventoryAggregateSummary,
} from './result';

const MAX_DATABASE_BATCH_SIZE = 100;
const MAX_FINDINGS = 10_000;

export interface HistoricalFinanceInventoryCliOptions {
  readonly databaseBatchSize: number;
  readonly maxFindings: number;
  readonly outputPath?: string;
  readonly includeStorage: boolean;
}

export class HistoricalFinanceInventoryCliUsageError extends Error {}

export interface HistoricalFinanceInventoryCliDependencies {
  readonly args: readonly string[];
  readonly scan: (options: Pick<HistoricalFinanceInventoryCliOptions, 'databaseBatchSize' | 'maxFindings'>) => Promise<HistoricalFinanceInventoryResult>;
  /** Omitted only when the storage configuration cannot be loaded safely. */
  readonly scanStorage?: () => Promise<StorageInventoryAggregateSummary>;
  readonly writeReceipt: (outputPath: string, receipt: HistoricalFinanceInventoryReceipt) => Promise<void>;
  readonly writeStdout: (message: string) => void;
}

function parseBoundedInteger(value: string, option: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HistoricalFinanceInventoryCliUsageError(`${option} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

/** Parses bounded options before any provider is created. */
export function parseHistoricalFinanceInventoryCliOptions(
  args: readonly string[],
): HistoricalFinanceInventoryCliOptions {
  let databaseBatchSize = MAX_DATABASE_BATCH_SIZE;
  let maxFindings = 1_000;
  let outputPath: string | undefined;
  let includeStorage = false;

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--include-storage') {
      includeStorage = true;
      continue;
    }
    if (option !== '--database-batch-size' && option !== '--max-findings' && option !== '--output') {
      throw new HistoricalFinanceInventoryCliUsageError(`Unknown option: ${option}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new HistoricalFinanceInventoryCliUsageError(`${option} requires a value`);
    }
    if (option === '--database-batch-size') {
      databaseBatchSize = parseBoundedInteger(value, option, 1, MAX_DATABASE_BATCH_SIZE);
    } else if (option === '--max-findings') {
      maxFindings = parseBoundedInteger(value, option, 0, MAX_FINDINGS);
    } else {
      outputPath = value;
    }
    index += 1;
  }

  return {
    databaseBatchSize,
    maxFindings,
    includeStorage,
    ...(outputPath === undefined ? {} : { outputPath }),
  };
}

function aggregateSummary(result: HistoricalFinanceInventoryResult): Record<string, unknown> {
  return {
    schemaVersion: result.schemaVersion,
    status: result.status,
    classificationTotals: result.classificationTotals,
    coverageCounts: result.coverageCounts,
    pagesRead: result.pagesRead,
    recordsRead: result.recordsRead,
    recordedFindings: result.recordedFindings,
    findingsTruncated: result.findingsTruncated,
    ...(result.operationalErrorCode === undefined ? {} : { operationalErrorCode: result.operationalErrorCode }),
  };
}

function skippedStorageSummary(): StorageInventoryAggregateSummary {
  return { status: 'SKIPPED_CONFIG_UNAVAILABLE', counts: {} };
}

/** Invokes a supplied read-only scanner and emits exactly one redacted summary. */
export async function runHistoricalFinanceInventoryCli(
  dependencies: HistoricalFinanceInventoryCliDependencies,
): Promise<0 | 2> {
  const options = parseHistoricalFinanceInventoryCliOptions(dependencies.args);
  const result = await dependencies.scan({
    databaseBatchSize: options.databaseBatchSize,
    maxFindings: options.maxFindings,
  });
  let storage: StorageInventoryAggregateSummary | undefined;
  if (options.includeStorage) {
    if (dependencies.scanStorage === undefined) {
      storage = skippedStorageSummary();
    } else {
      try {
        storage = await dependencies.scanStorage();
      } catch (_error: unknown) {
        storage = storageOperationalFailureSummary();
      }
    }
  }
  const receipt = composeFinanceAndStorageSummaries(result, storage);

  if (options.outputPath !== undefined) {
    try {
      await dependencies.writeReceipt(options.outputPath, receipt);
    } catch (_error: unknown) {
      dependencies.writeStdout(JSON.stringify({
        schemaVersion: result.schemaVersion,
        status: 'INCOMPLETE_OPERATIONAL_ERROR',
        operationalErrorCode: 'RECEIPT_WRITE_FAILED',
      }));
      return 2;
    }
  }

  dependencies.writeStdout(JSON.stringify({
    ...aggregateSummary(result),
    ...(storage === undefined ? {} : { storage }),
  }));
  return (result.status === 'COMPLETE_CLEAN' || result.status === 'COMPLETE_WITH_FINDINGS')
    && storage?.status !== 'INCOMPLETE_OPERATIONAL_ERROR'
    ? 0
    : 2;
}
