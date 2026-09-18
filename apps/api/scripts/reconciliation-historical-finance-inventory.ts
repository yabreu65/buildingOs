import { loadConfigOrThrow } from '../src/config/config';
import { ConfigService } from '../src/config/config.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PrismaDbToStorageDatabase } from '../src/reconciliation/db-to-storage/prisma-db-to-storage.database';
import { HistoricalInventoryScanner } from '../src/reconciliation/historical-inventory/historical-inventory.scanner';
import { MinioService } from '../src/storage/minio.service';
import {
  createPrismaReadOnlyFinanceInventoryAdapter,
} from '../src/reconciliation/historical-finance-inventory/adapter';
import {
  HistoricalFinanceInventoryCliOptions,
  parseHistoricalFinanceInventoryCliOptions,
  runHistoricalFinanceInventoryCli,
} from '../src/reconciliation/historical-finance-inventory/cli';
import { ReadOnlyFinanceInventoryAdapter } from '../src/reconciliation/historical-finance-inventory/contracts';
import { writeProtectedReceipt } from '../src/reconciliation/historical-finance-inventory/receipt';
import {
  StorageInventoryAggregateSummary,
  summarizeHistoricalStorageInventoryReceipt,
} from '../src/reconciliation/historical-finance-inventory/result';
import { HistoricalFinanceInventoryScanner } from '../src/reconciliation/historical-finance-inventory/scanner';

const LOCAL_NODE_ENVIRONMENTS = new Set(['development', 'test']);

/** Rejects non-local execution before a database client can be created. */
export function assertLocalNodeEnvironment(nodeEnv: string | undefined): asserts nodeEnv is 'development' | 'test' {
  if (nodeEnv === undefined || !LOCAL_NODE_ENVIRONMENTS.has(nodeEnv)) {
    throw new Error('Historical finance inventory is restricted to NODE_ENV=development or NODE_ENV=test');
  }
}

function withDatabaseBatchSize(
  adapter: ReadOnlyFinanceInventoryAdapter,
  databaseBatchSize: number,
): ReadOnlyFinanceInventoryAdapter {
  return {
    listPage(entity, request) {
      return adapter.listPage(entity, { ...request, limit: databaseBatchSize });
    },
  };
}

function writeExecutionFailure(): void {
  process.stderr.write('Historical finance inventory execution failed\n');
}

/** Loads storage configuration without allowing startup diagnostics to escape this aggregate-only CLI. */
function loadStorageConfig(): ConfigService | undefined {
  const originalWrite = process.stdout.write;
  try {
    process.stdout.write = (() => true) as typeof process.stdout.write;
    return new ConfigService(loadConfigOrThrow());
  } catch (_error: unknown) {
    return undefined;
  } finally {
    process.stdout.write = originalWrite;
  }
}

function createHistoricalStorageScan(
  prisma: PrismaService,
  options: HistoricalFinanceInventoryCliOptions,
): () => Promise<StorageInventoryAggregateSummary> {
  return async () => {
    const config = loadStorageConfig();
    if (config === undefined) {
      return { status: 'SKIPPED_CONFIG_UNAVAILABLE', counts: {} };
    }

    const receipt = await new HistoricalInventoryScanner(
      new PrismaDbToStorageDatabase(prisma),
      new MinioService(config),
      {
        databaseBatchSize: options.databaseBatchSize,
        maxFindings: options.maxFindings,
      },
    ).scan();
    return summarizeHistoricalStorageInventoryReceipt(receipt);
  };
}

/** Executes the local-only, read-only historical finance inventory. */
export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let options: HistoricalFinanceInventoryCliOptions;
  try {
    options = parseHistoricalFinanceInventoryCliOptions(argv);
  } catch (_error: unknown) {
    process.stderr.write('Invalid historical finance inventory arguments\n');
    return 64;
  }

  try {
    assertLocalNodeEnvironment(process.env.NODE_ENV);
  } catch (_error: unknown) {
    writeExecutionFailure();
    return 2;
  }

  let prisma: PrismaService | undefined;
  let exitCode = 2;
  try {
    prisma = new PrismaService();
    await prisma.$connect();
    const adapter = withDatabaseBatchSize(
      createPrismaReadOnlyFinanceInventoryAdapter(prisma),
      options.databaseBatchSize,
    );
    const scanner = new HistoricalFinanceInventoryScanner(adapter, {
      maxFindings: options.maxFindings,
    });

    exitCode = await runHistoricalFinanceInventoryCli({
      args: argv,
      scan: async () => scanner.scan(),
      ...(options.includeStorage ? { scanStorage: createHistoricalStorageScan(prisma, options) } : {}),
      writeReceipt: writeProtectedReceipt,
      writeStdout: (message) => process.stdout.write(`${message}\n`),
    });
  } catch (_error: unknown) {
    writeExecutionFailure();
    exitCode = 2;
  } finally {
    if (prisma !== undefined) {
      try {
        await prisma.$disconnect();
      } catch (_error: unknown) {
        writeExecutionFailure();
        exitCode = 2;
      }
    }
  }

  return exitCode;
}

if (require.main === module) {
  void runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
