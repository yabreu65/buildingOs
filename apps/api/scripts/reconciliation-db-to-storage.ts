import { chmod, writeFile } from 'node:fs/promises';
import { PrismaService } from '../src/prisma/prisma.service';
import { loadConfig } from '../src/config/config';
import { ConfigService } from '../src/config/config.service';
import { MinioService } from '../src/storage/minio.service';
import { DbToStorageScanner } from '../src/reconciliation/db-to-storage/db-to-storage.scanner';
import { exitCodeForScanStatus } from '../src/reconciliation/db-to-storage/db-to-storage.exit-code';
import { PrismaDbToStorageDatabase } from '../src/reconciliation/db-to-storage/prisma-db-to-storage.database';
import { ScanReceipt } from '../src/reconciliation/db-to-storage/db-to-storage.types';

interface CliOptions {
  readonly batchSize: number;
  readonly maxFindings: number;
  readonly outputPath?: string;
}

class CliUsageError extends Error {}

function parseInteger(value: string, optionName: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new CliUsageError(`${optionName} must be an integer >= ${minimum}`);
  }
  return parsed;
}

function parseArgs(argv: readonly string[]): CliOptions | null {
  let batchSize = 100;
  let maxFindings = 1000;
  let outputPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      process.stdout.write('Usage: reconciliation-db-to-storage [--batch-size N] [--max-findings N] [--output PATH]\n');
      return null;
    }

    if (argument === '--batch-size' || argument === '--max-findings' || argument === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new CliUsageError(`${argument} requires a value`);
      }

      if (argument === '--batch-size') {
        batchSize = parseInteger(value, argument, 1);
      } else if (argument === '--max-findings') {
        maxFindings = parseInteger(value, argument, 0);
      } else {
        outputPath = value;
      }

      index += 1;
      continue;
    }

    throw new CliUsageError(`Unknown option: ${argument}`);
  }

  return { batchSize, maxFindings, ...(outputPath ? { outputPath } : {}) };
}

function conciseSummary(receipt: ScanReceipt): Record<string, unknown> {
  return {
    scannerName: receipt.scannerName,
    consistencyModel: receipt.consistencyModel,
    recordsScanned: receipt.recordsScanned,
    classificationCounts: receipt.classificationCounts,
    storageObservationCounts: receipt.storageObservationCounts,
    operationalErrorCount: receipt.operationalErrorCount,
    scanStatus: receipt.scanStatus,
  };
}

export async function writeReceiptFile(outputPath: string, content: string): Promise<void> {
  await writeFile(outputPath, content, { encoding: 'utf8', mode: 0o600 });
  await chmod(outputPath, 0o600);
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let options: CliOptions | null;
  try {
    options = parseArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid CLI arguments';
    process.stderr.write(`${message}\n`);
    return 64;
  }

  if (!options) {
    return 0;
  }

  let prisma: PrismaService | undefined;
  try {
    const config = new ConfigService(loadConfig());
    prisma = new PrismaService();
    await prisma.$connect();
    const storage = new MinioService(config);
    const database = new PrismaDbToStorageDatabase(prisma);
    const receipt = await new DbToStorageScanner(database, storage, options).scan();

    if (options.outputPath) {
      await writeReceiptFile(options.outputPath, `${JSON.stringify(receipt, null, 2)}\n`);
    }

    process.stdout.write(`${JSON.stringify(conciseSummary(receipt))}\n`);
    return exitCodeForScanStatus(receipt.scanStatus);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scanner execution failed';
    process.stderr.write(`${message}\n`);
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
