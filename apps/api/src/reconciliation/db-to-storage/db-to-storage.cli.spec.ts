import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../../../scripts/reconciliation-db-to-storage';
import { writeReceiptFile } from '../../../scripts/reconciliation-db-to-storage';
import { exitCodeForScanStatus } from './db-to-storage.exit-code';

describe('reconciliation-db-to-storage CLI', () => {
  it('returns usage exit code 64 for invalid arguments', async () => {
    await expect(runCli(['--batch-size', '0'])).resolves.toBe(64);
    await expect(runCli(['--unknown'])).resolves.toBe(64);
  });

  it('returns success for help without loading application configuration', async () => {
    await expect(runCli(['--help'])).resolves.toBe(0);
  });

  it.each([
    ['COMPLETE_CLEAN', 0],
    ['COMPLETE_WITH_FINDINGS', 0],
    ['INCOMPLETE_OPERATIONAL_ERROR', 2],
  ] as const)('maps %s to exit code %s', (status, exitCode) => {
    expect(exitCodeForScanStatus(status)).toBe(exitCode);
  });

  it('writes receipt files with restrictive local permissions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'db-to-storage-receipt-'));
    const outputPath = join(directory, 'receipt.json');

    try {
      await writeReceiptFile(outputPath, '{"scanStatus":"COMPLETE_CLEAN"}\n');

      expect(await readFile(outputPath, 'utf8')).toBe('{"scanStatus":"COMPLETE_CLEAN"}\n');
      expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
