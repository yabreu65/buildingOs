import { chmod, writeFile } from 'node:fs/promises';
import type {
  HistoricalInventoryReceipt,
  HistoricalScanStatus,
} from './historical-inventory.types';

export interface HistoricalInventoryCliOptions {
  readonly databaseBatchSize: number;
  readonly storagePageSize: number;
  readonly maxFindings: number;
  readonly outputPath?: string;
}

export class HistoricalInventoryCliUsageError extends Error {}

function parseInteger(value: string, optionName: string, minimum: number, maximum?: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || maximum !== undefined && parsed > maximum) {
    const range = maximum === undefined ? `>= ${minimum}` : `between ${minimum} and ${maximum}`;
    throw new HistoricalInventoryCliUsageError(`${optionName} must be an integer ${range}`);
  }
  return parsed;
}

/**
 * Parses bounded, read-only scanner options before loading configuration or
 * creating database and object-storage providers.
 */
export function parseHistoricalInventoryCliArgs(
  argv: readonly string[],
  executableName = 'reconciliation-historical-inventory',
): HistoricalInventoryCliOptions | null {
  let databaseBatchSize = 100;
  let storagePageSize = 100;
  let maxFindings = 1000;
  let outputPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      process.stdout.write(
        `Usage: ${executableName} [--database-batch-size N] [--storage-page-size N] [--max-findings N] [--output PATH]\n`,
      );
      return null;
    }

    if (
      argument !== '--database-batch-size'
      && argument !== '--storage-page-size'
      && argument !== '--max-findings'
      && argument !== '--output'
    ) {
      throw new HistoricalInventoryCliUsageError(`Unknown option: ${argument}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new HistoricalInventoryCliUsageError(`${argument} requires a value`);
    }

    if (argument === '--database-batch-size') {
      databaseBatchSize = parseInteger(value, argument, 1);
    } else if (argument === '--storage-page-size') {
      storagePageSize = parseInteger(value, argument, 1, 1000);
    } else if (argument === '--max-findings') {
      maxFindings = parseInteger(value, argument, 0);
    } else {
      outputPath = value;
    }
    index += 1;
  }

  return {
    databaseBatchSize,
    storagePageSize,
    maxFindings,
    ...(outputPath ? { outputPath } : {}),
  };
}

export function conciseHistoricalSummary(receipt: HistoricalInventoryReceipt): Record<string, unknown> {
  return {
    scannerName: receipt.scannerName,
    consistencyModel: receipt.consistencyModel,
    databaseRowsScanned: receipt.databaseRowsScanned,
    databaseReferencesScanned: receipt.databaseReferencesScanned,
    storageEntriesScanned: receipt.storageEntriesScanned,
    bucketsScanned: receipt.bucketsScanned,
    referenceOutcomeCounts: receipt.referenceOutcomeCounts,
    storageOutcomeCounts: receipt.storageOutcomeCounts,
    dispositionCounts: receipt.dispositionCounts,
    operationalErrorCount: receipt.operationalErrorCount,
    scanStatus: receipt.scanStatus,
  };
}

export function exitCodeForStatus(status: HistoricalScanStatus): 0 | 2 {
  return status === 'INCOMPLETE_OPERATIONAL_ERROR' ? 2 : 0;
}

export async function writeHistoricalInventoryReceiptFile(
  outputPath: string,
  receipt: HistoricalInventoryReceipt,
): Promise<void> {
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(outputPath, 0o600);
}
