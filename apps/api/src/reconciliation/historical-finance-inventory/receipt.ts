import { chmod, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { HistoricalFinanceInventoryReceipt } from './result';

function temporaryReceiptPath(outputPath: string): string {
  return join(dirname(outputPath), `.${Date.now()}-${process.pid}-historical-finance-inventory.tmp`);
}

/** Writes the aggregate receipt atomically and enforces owner-only permissions. */
export async function writeProtectedReceipt(
  outputPath: string,
  result: HistoricalFinanceInventoryReceipt,
): Promise<void> {
  const temporaryPath = temporaryReceiptPath(outputPath);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(result, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, outputPath);
    await chmod(outputPath, 0o600);
  } catch (error: unknown) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
