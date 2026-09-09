import { loadConfig } from '../../config/config';
import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../../storage/minio.service';
import { PrismaDbToStorageDatabase } from '../db-to-storage/prisma-db-to-storage.database';
import { HistoricalInventoryScanner } from './historical-inventory.scanner';
import {
  conciseHistoricalSummary,
  exitCodeForStatus,
  HistoricalInventoryCliUsageError,
  parseHistoricalInventoryCliArgs,
  writeHistoricalInventoryReceiptFile,
} from './historical-inventory.operational.shared';
import type { HistoricalInventoryCliOptions } from './historical-inventory.operational.shared';

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

export enum OperationalFailureCategory {
  CONFIG = 'CONFIG',
  AUTHORIZATION = 'AUTHORIZATION',
  DB_CONNECT = 'DB_CONNECT',
  STORAGE_CONNECT = 'STORAGE_CONNECT',
  SCANNER = 'SCANNER',
  RECEIPT_WRITE = 'RECEIPT_WRITE',
  CLEANUP = 'CLEANUP',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Requires the actual runtime NODE_ENV and its environment-specific explicit
 * acknowledgement before the CLI creates database or storage providers.
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

export function formatOperationalFailure(category: OperationalFailureCategory): string {
  return `Operational historical inventory failed [${category}]\n`;
}

function reportOperationalFailure(category: OperationalFailureCategory): 2 {
  process.stderr.write(formatOperationalFailure(category));
  return 2;
}

/**
 * Runs the operational scanner from compiled application source. The gate is
 * evaluated before creating database or object-storage provider clients.
 */
export async function runOperationalCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let options: HistoricalInventoryCliOptions | null;
  try {
    options = parseHistoricalInventoryCliArgs(argv, 'historical-inventory-operational');
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof HistoricalInventoryCliUsageError ? error.message : 'Invalid CLI arguments'}\n`);
    return 64;
  }

  if (!options) {
    return 0;
  }

  let config: ConfigService;
  try {
    config = new ConfigService(loadConfig());
  } catch (_error: unknown) {
    return reportOperationalFailure(OperationalFailureCategory.CONFIG);
  }

  try {
    assertOperationalNodeEnvironment(config.getValue('nodeEnv'));
  } catch (_error: unknown) {
    return reportOperationalFailure(OperationalFailureCategory.AUTHORIZATION);
  }

  let prisma: PrismaService;
  try {
    prisma = new PrismaService();
    await prisma.$connect();
  } catch (_error: unknown) {
    return reportOperationalFailure(OperationalFailureCategory.DB_CONNECT);
  }

  try {
    const receipt = await new HistoricalInventoryScanner(
      new PrismaDbToStorageDatabase(prisma),
      new MinioService(config),
      options,
    ).scan();

    if (options.outputPath) {
      try {
        await writeHistoricalInventoryReceiptFile(options.outputPath, receipt);
      } catch (_error: unknown) {
        return reportOperationalFailure(OperationalFailureCategory.RECEIPT_WRITE);
      }
    }

    process.stdout.write(`${JSON.stringify(conciseHistoricalSummary(receipt))}\n`);
    return exitCodeForStatus(receipt.scanStatus);
  } catch (_error: unknown) {
    return reportOperationalFailure(OperationalFailureCategory.SCANNER);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void runOperationalCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
