import { FINANCE_INVENTORY_ENTITIES } from './contracts';
import {
  composeFinanceAndStorageSummaries,
  HistoricalFinanceInventoryResult,
  resolveInventoryStatus,
  storageOperationalFailureSummary,
  summarizeHistoricalStorageInventoryReceipt,
} from './result';

function financeResult(): HistoricalFinanceInventoryResult {
  return {
    schemaVersion: 'historical-finance-inventory/v1',
    status: 'COMPLETE_CLEAN',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    coverageCounts: Object.fromEntries(FINANCE_INVENTORY_ENTITIES.map((entity) => [entity, 0])) as HistoricalFinanceInventoryResult['coverageCounts'],
    classificationTotals: { SAFE: 0, LEGACY_SUPPORTED: 0, REPAIRABLE: 0, INVALID_BLOCKING: 0 },
    findingCategoryCounts: {},
    pagesRead: 0,
    recordsRead: 0,
    recordedFindings: 0,
    findingsTruncated: false,
    redaction: { tenantIdentifiers: 'excluded', recordIdentifiers: 'excluded', amounts: 'excluded', cursors: 'excluded', rawPayloads: 'excluded', stackTraces: 'excluded' },
  };
}

describe('historical finance result status', () => {
  it('uses each exact status for clean, non-blocking, blocking, and operational results', () => {
    expect(resolveInventoryStatus({ SAFE: 1, LEGACY_SUPPORTED: 0, REPAIRABLE: 0, INVALID_BLOCKING: 0 }, false)).toBe('COMPLETE_CLEAN');
    expect(resolveInventoryStatus({ SAFE: 0, LEGACY_SUPPORTED: 1, REPAIRABLE: 0, INVALID_BLOCKING: 0 }, false)).toBe('COMPLETE_WITH_FINDINGS');
    expect(resolveInventoryStatus({ SAFE: 0, LEGACY_SUPPORTED: 0, REPAIRABLE: 0, INVALID_BLOCKING: 1 }, false)).toBe('COMPLETE_WITH_BLOCKING_FINDINGS');
    expect(resolveInventoryStatus({ SAFE: 0, LEGACY_SUPPORTED: 0, REPAIRABLE: 0, INVALID_BLOCKING: 0 }, true)).toBe('COMPLETE_WITH_BLOCKING_FINDINGS');
    expect(resolveInventoryStatus({ SAFE: 0, LEGACY_SUPPORTED: 0, REPAIRABLE: 0, INVALID_BLOCKING: 0 }, false, 'ADAPTER_READ_FAILED')).toBe('INCOMPLETE_OPERATIONAL_ERROR');
  });
});

describe('separate inventory summary composition', () => {
  it('leaves finance output unchanged when no storage result is supplied', () => {
    expect(composeFinanceAndStorageSummaries(financeResult())).toEqual({ finance: financeResult() });
  });

  it('keeps finance and storage aggregate statuses and counts distinct', () => {
    const storage = { status: 'COMPLETE_WITH_FINDINGS' as const, counts: { ORPHAN_HISTORICAL_VERSION: 2 } };
    expect(composeFinanceAndStorageSummaries(financeResult(), storage)).toEqual({ finance: financeResult(), storage });
  });

  it('redacts the existing historical storage receipt to aggregate counts', () => {
    expect(summarizeHistoricalStorageInventoryReceipt({
      schemaVersion: '1.0',
      scannerName: 'historical-object-inventory',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
      consistencyModel: 'MOVING_WINDOW',
      databaseRowsScanned: 1,
      databaseReferencesScanned: 2,
      storageEntriesScanned: 3,
      bucketsScanned: 1,
      referenceOutcomeCounts: {
        EXACT_REFERENCED_VERSION_PRESENT: 1,
        EXACT_REFERENCED_VERSION_MISSING: 0,
        LEGACY_KEY_ONLY_REFERENCE: 0,
        INVALID_REFERENCE: 0,
        CROSS_TENANT_REFERENCE: 0,
        PROVIDER_OPERATIONAL_ERROR: 0,
      },
      storageOutcomeCounts: {
        CURRENT_OBJECT: 2,
        NONCURRENT_VERSION: 1,
        LATEST_DELETE_MARKER: 0,
        NONCURRENT_DELETE_MARKER: 0,
        CURRENT_ORPHAN_OBJECT: 0,
        ORPHAN_HISTORICAL_VERSION: 0,
      },
      dispositionCounts: { PRESERVE: 0, REPAIR_REQUIRED_LATER: 0, OPERATIONAL_ERROR: 0 },
      operationalErrorCount: 0,
      scanStatus: 'COMPLETE_CLEAN',
      detailedFindings: [{ source: 'STORAGE', outcome: 'CURRENT_OBJECT', disposition: 'NONE', objectReference: 'record-id' }],
    })).toEqual({
      status: 'COMPLETE_CLEAN',
      counts: {
        databaseRowsScanned: 1,
        databaseReferencesScanned: 2,
        storageEntriesScanned: 3,
        bucketsScanned: 1,
        operationalErrorCount: 0,
        'reference:EXACT_REFERENCED_VERSION_PRESENT': 1,
        'reference:EXACT_REFERENCED_VERSION_MISSING': 0,
        'reference:LEGACY_KEY_ONLY_REFERENCE': 0,
        'reference:INVALID_REFERENCE': 0,
        'reference:CROSS_TENANT_REFERENCE': 0,
        'reference:PROVIDER_OPERATIONAL_ERROR': 0,
        'storage:CURRENT_OBJECT': 2,
        'storage:NONCURRENT_VERSION': 1,
        'storage:LATEST_DELETE_MARKER': 0,
        'storage:NONCURRENT_DELETE_MARKER': 0,
        'storage:CURRENT_ORPHAN_OBJECT': 0,
        'storage:ORPHAN_HISTORICAL_VERSION': 0,
        'disposition:PRESERVE': 0,
        'disposition:REPAIR_REQUIRED_LATER': 0,
        'disposition:OPERATIONAL_ERROR': 0,
      },
    });
    expect(storageOperationalFailureSummary()).toEqual({
      status: 'INCOMPLETE_OPERATIONAL_ERROR',
      counts: {},
      operationalErrorCode: 'STORAGE_SCAN_FAILED',
    });
  });
});
