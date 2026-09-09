import { loadConfig } from '../src/config/config';
import { ConfigService } from '../src/config/config.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PrismaDbToStorageDatabase } from '../src/reconciliation/db-to-storage/prisma-db-to-storage.database';
import { HistoricalInventoryScanner } from '../src/reconciliation/historical-inventory/historical-inventory.scanner';
import {
  conciseHistoricalSummary,
  exitCodeForStatus,
  HistoricalInventoryCliUsageError,
  parseHistoricalInventoryCliArgs,
  writeHistoricalInventoryReceiptFile,
} from '../src/reconciliation/historical-inventory/historical-inventory.operational.shared';
import type { HistoricalInventoryCliOptions } from '../src/reconciliation/historical-inventory/historical-inventory.operational.shared';
import { MinioService } from '../src/storage/minio.service';

export function assertLocalNodeEnvironment(nodeEnv: string): void {
  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new Error('Historical inventory is restricted to local development/test environments');
  }
}

export {
  conciseHistoricalSummary,
  parseHistoricalInventoryCliArgs,
  writeHistoricalInventoryReceiptFile,
};
export type { HistoricalInventoryCliOptions };

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let options: HistoricalInventoryCliOptions | null;
  try {
    options = parseHistoricalInventoryCliArgs(argv);
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof HistoricalInventoryCliUsageError ? error.message : 'Invalid CLI arguments'}\n`);
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
      await writeHistoricalInventoryReceiptFile(options.outputPath, receipt);
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
