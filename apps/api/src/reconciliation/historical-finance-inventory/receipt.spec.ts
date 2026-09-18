import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FINANCE_INVENTORY_ENTITIES } from './contracts';
import { HistoricalFinanceInventoryResult } from './result';
import { writeProtectedReceipt } from './receipt';

function result(status: HistoricalFinanceInventoryResult['status'] = 'COMPLETE_WITH_FINDINGS'): HistoricalFinanceInventoryResult {
  return {
    schemaVersion: 'historical-finance-inventory/v1',
    status,
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    coverageCounts: Object.fromEntries(FINANCE_INVENTORY_ENTITIES.map((entity) => [entity, 0])) as HistoricalFinanceInventoryResult['coverageCounts'],
    classificationTotals: { SAFE: 0, LEGACY_SUPPORTED: 1, REPAIRABLE: 1, INVALID_BLOCKING: 0 },
    findingCategoryCounts: { SUPPORTED_LEGACY: 1, UNSUPPORTED_VARIANT: 1 },
    pagesRead: 2,
    recordsRead: 2,
    recordedFindings: 2,
    findingsTruncated: false,
    redaction: { tenantIdentifiers: 'excluded', recordIdentifiers: 'excluded', amounts: 'excluded', cursors: 'excluded', rawPayloads: 'excluded', stackTraces: 'excluded' },
  };
}

describe('protected historical finance receipts', () => {
  it('writes a versioned aggregate-only receipt with mode 0600', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'finance-inventory-'));
    const outputPath = join(directory, 'receipt.json');
    try {
      await writeProtectedReceipt(outputPath, result());
      const [contents, metadata] = await Promise.all([readFile(outputPath, 'utf8'), stat(outputPath)]);

      expect(JSON.parse(contents)).toEqual(result());
      expect(metadata.mode & 0o777).toBe(0o600);
      expect(contents).not.toContain('tenant-a');
      expect(contents).not.toContain('record-1');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects receipt destinations that cannot be protected', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'finance-inventory-'));
    try {
      await expect(writeProtectedReceipt(directory, result())).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
