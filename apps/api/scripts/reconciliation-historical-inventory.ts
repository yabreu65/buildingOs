import { chmod, writeFile } from 'node:fs/promises';
import { loadConfig } from '../src/config/config';
import { ConfigService } from '../src/config/config.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PrismaDbToStorageDatabase } from '../src/reconciliation/db-to-storage/prisma-db-to-storage.database';
import { HistoricalInventoryScanner } from '../src/reconciliation/historical-inventory/historical-inventory.scanner';
import {
  HistoricalInventoryReceipt,
  HistoricalScanStatus,
} from '../src/reconciliation/historical-inventory/historical-inventory.types';
import { MinioService } from '../src/storage/minio.service';

interface CliOptions {
  readonly databaseBatchSize: number;
  readonly storagePageSize: number;
  readonly maxFindings: number;
  readonly outputPath?: string;
}

class CliUsageError extends Error {}

function parseInteger(value: string, optionName: string, minimum: number, maximum?: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || maximum !== undefined && parsed > maximum) {
    const range = maximum === undefined ? `>= ${minimum}` : `between ${minimum} and ${maximum}`;
    throw new CliUsageError(`${optionName} must be an integer ${range}`);
  }
  return parsed;
}

function parseArgs(argv: readonly string[]): CliOptions | null {
  let databaseBatchSize = 100;
  let storagePageSize = 100;
  let maxFindings = 1000;
  let outputPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      process.stdout.write(
        'Usage: reconciliation-historical-inventory [--database-batch-size N] [--storage-page-size N] [--max-findings N] [--output PATH]\n',
      );
      return null;
    }

    if (
      argument !== '--database-batch-size'
      && argument !== '--storage-page-size'
      && argument !== '--max-findings'
      && argument !== '--output'
    ) {
      throw new CliUsageError(`Unknown option: ${argument}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new CliUsageError(`${argument} requires a value`);
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

export function assertLocalNodeEnvironment(nodeEnv: string): void {
  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new Error('Historical inventory is restricted to local development/test environments');
  }
}

function exitCodeForStatus(status: HistoricalScanStatus): 0 | 2 {
  return status === 'INCOMPLETE_OPERATIONAL_ERROR' ? 2 : 0;
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

async function writeReceiptFile(outputPath: string, receipt: HistoricalInventoryReceipt): Promise<void> {
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(outputPath, 0o600);
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let options: CliOptions | null;
  try {
    options = parseArgs(argv);
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof CliUsageError ? error.message : 'Invalid CLI arguments'}\n`);
    return 64;
  }

  if (!options) {
    return 0;
  }

  let prisma: PrismaService | undefined;
  try {
    const config = new ConfigService(loadConfig());
    assertLocalNodeEnvironment(config.getValue('nodeEnv'));
    prisma = new PrismaService();
    await prisma.$connect();

    const receipt = await new HistoricalInventoryScanner(
      new PrismaDbToStorageDatabase(prisma),
      new MinioService(config),
      options,
    ).scan();

    if (options.outputPath) {
      await writeReceiptFile(options.outputPath, receipt);
    }
    process.stdout.write(`${JSON.stringify(conciseHistoricalSummary(receipt))}\n`);
    return exitCodeForStatus(receipt.scanStatus);
  } catch (_error: unknown) {
    process.stderr.write('Historical inventory execution failed\n');
    return 2;
  } finally {
    if (prisma) {
      await prisma.$disconnect();
    }
  }
}

if (require.main === module) {
  void runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
