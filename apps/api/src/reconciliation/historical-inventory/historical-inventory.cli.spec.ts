import {
  assertLocalNodeEnvironment,
  conciseHistoricalSummary,
  runCli,
} from '../../../scripts/reconciliation-historical-inventory';
import { HistoricalInventoryReceipt } from './historical-inventory.types';

function receipt(): HistoricalInventoryReceipt {
  return {
    schemaVersion: '1.0',
    scannerName: 'historical-object-inventory',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    consistencyModel: 'MOVING_WINDOW',
    databaseRowsScanned: 1,
    databaseReferencesScanned: 1,
    storageEntriesScanned: 1,
    bucketsScanned: 1,
    referenceOutcomeCounts: {
      EXACT_REFERENCED_VERSION_PRESENT: 0,
      EXACT_REFERENCED_VERSION_MISSING: 1,
      LEGACY_KEY_ONLY_REFERENCE: 0,
      INVALID_REFERENCE: 0,
      CROSS_TENANT_REFERENCE: 0,
      PROVIDER_OPERATIONAL_ERROR: 0,
    },
    storageOutcomeCounts: {
      CURRENT_OBJECT: 0,
      NONCURRENT_VERSION: 0,
      LATEST_DELETE_MARKER: 0,
      NONCURRENT_DELETE_MARKER: 0,
      CURRENT_ORPHAN_OBJECT: 1,
      ORPHAN_HISTORICAL_VERSION: 0,
    },
    dispositionCounts: {
      PRESERVE: 1,
      REPAIR_REQUIRED_LATER: 1,
      OPERATIONAL_ERROR: 0,
    },
    operationalErrorCount: 0,
    scanStatus: 'COMPLETE_WITH_FINDINGS',
    detailedFindings: [{
      source: 'File',
      outcome: 'EXACT_REFERENCED_VERSION_MISSING',
      disposition: 'REPAIR_REQUIRED_LATER',
      objectReference: '[redacted:4-segments:leaf-length-18]',
      versionReference: '[redacted-version:length-32]',
    }],
  };
}

describe('reconciliation-historical-inventory CLI', () => {
  it('enforces local-only execution', () => {
    expect(() => assertLocalNodeEnvironment('development')).not.toThrow();
    expect(() => assertLocalNodeEnvironment('test')).not.toThrow();
    expect(() => assertLocalNodeEnvironment('staging')).toThrow('restricted to local');
    expect(() => assertLocalNodeEnvironment('production')).toThrow('restricted to local');
  });

  it('returns help before loading runtime configuration', async () => {
    await expect(runCli(['--help'])).resolves.toBe(0);
  });

  it('returns usage errors for invalid bounded listing arguments', async () => {
    await expect(runCli(['--storage-page-size', '1001'])).resolves.toBe(64);
    await expect(runCli(['--database-batch-size', '0'])).resolves.toBe(64);
  });

  it('keeps concise output aggregate-only', () => {
    const summary = conciseHistoricalSummary(receipt());

    expect(summary).not.toHaveProperty('detailedFindings');
    expect(JSON.stringify(summary)).not.toContain('redacted-version');
    expect(JSON.stringify(summary)).not.toContain('redacted:');
  });
});
