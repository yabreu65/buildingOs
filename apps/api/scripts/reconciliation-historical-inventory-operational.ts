import { loadConfig } from '../src/config/config';
import { ConfigService } from '../src/config/config.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PrismaDbToStorageDatabase } from '../src/reconciliation/db-to-storage/prisma-db-to-storage.database';
import { HistoricalInventoryScanner } from '../src/reconciliation/historical-inventory/historical-inventory.scanner';
import { MinioService } from '../src/storage/minio.service';
import {
  conciseHistoricalSummary,
  HistoricalInventoryCliOptions,
  parseHistoricalInventoryCliArgs,
  writeHistoricalInventoryReceiptFile,
} from './reconciliation-historical-inventory';

export const OPERATIONAL_STAGING_CONFIRMATION_VARIABLE = 'HISTORICAL_INVENTORY_OPERATIONAL_STAGING_CONFIRMATION';
export const OPERATIONAL_STAGING_CONFIRMATION_TOKEN = 'HISTORICAL-INVENTORY-STAGING-READ-ONLY';
export const OPERATIONAL_PRODUCTION_CONFIRMATION_VARIABLE = 'HISTORICAL_INVENTORY_OPERATIONAL_PRODUCTION_CONFIRMATION';
export const OPERATIONAL_PRODUCTION_CONFIRMATION_TOKEN = 'HISTORICAL-INVENTORY-PRODUCTION-READ-ONLY';

export interface OperationalEnvironment {
  readonly [key: string]: string | undefined;
  readonly NODE_ENV?: string;
  readonly HISTORICAL_INVENTORY_OPERATIONAL_STAGING_CONFIRMATION?: string;
  readonly HISTORICAL_INVENTORY_OPERATIONAL_PRODUCTION_CONFIRMATION?: string;
}

/**
 * Requires the runtime NODE_ENV and its environment-specific acknowledgement
 * before the operational entrypoint can create any provider clients.
 */
export function assertOperationalNodeEnvironment(
  nodeEnv: string,
  environment: OperationalEnvironment = process.env,
): void {
  if (environment.NODE_ENV !== nodeEnv) {
    throw new Error(`Operational historical inventory requires actual NODE_ENV=${nodeEnv}`);
  }

  if (nodeEnv === 'staging') {
    if (environment.HISTORICAL_INVENTORY_OPERATIONAL_STAGING_CONFIRMATION !== OPERATIONAL_STAGING_CONFIRMATION_TOKEN) {
      throw new Error(`${OPERATIONAL_STAGING_CONFIRMATION_VARIABLE} must be exactly ${OPERATIONAL_STAGING_CONFIRMATION_TOKEN}`);
    }
    return;
  }

  if (nodeEnv === 'production') {
    if (environment.HISTORICAL_INVENTORY_OPERATIONAL_PRODUCTION_CONFIRMATION !== OPERATIONAL_PRODUCTION_CONFIRMATION_TOKEN) {
      throw new Error(`${OPERATIONAL_PRODUCTION_CONFIRMATION_VARIABLE} must be exactly ${OPERATIONAL_PRODUCTION_CONFIRMATION_TOKEN}`);
    }
    return;
  }

  throw new Error('Operational historical inventory is restricted to staging or production');
}

export async function runOperationalCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let options: HistoricalInventoryCliOptions | null;
  try {
    options = parseHistoricalInventoryCliArgs(argv, 'reconciliation-historical-inventory-operational');
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Invalid CLI arguments'}\n`);
    return 64;
  }

  if (!options) {
    return 0;
  }

  let prisma: PrismaService | undefined;
  try {
    const config = new ConfigService(loadConfig());
    assertOperationalNodeEnvironment(config.getValue('nodeEnv'));
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
    return receipt.scanStatus === 'INCOMPLETE_OPERATIONAL_ERROR' ? 2 : 0;
  } catch (_error: unknown) {
    process.stderr.write('Operational historical inventory execution failed\n');
    return 2;
  } finally {
    if (prisma) {
      await prisma.$disconnect();
    }
  }
}

if (require.main === module) {
  void runOperationalCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
