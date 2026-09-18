import {
  HistoricalFinanceInventoryCliUsageError,
  parseHistoricalFinanceInventoryCliOptions,
  runHistoricalFinanceInventoryCli,
} from './cli';
import { FINANCE_INVENTORY_ENTITIES } from './contracts';
import { HistoricalFinanceInventoryResult } from './result';
import { PrismaService } from '../../prisma/prisma.service';
import {
  assertLocalNodeEnvironment,
  runCli,
} from '../../../scripts/reconciliation-historical-finance-inventory';

jest.mock('../../prisma/prisma.service', () => ({ PrismaService: jest.fn() }));

const mockedPrismaService = PrismaService as jest.MockedClass<typeof PrismaService>;

function cleanResult(): HistoricalFinanceInventoryResult {
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

describe('historical finance inventory CLI', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('allows only development and test before a Prisma client can be created', async () => {
    expect(() => assertLocalNodeEnvironment('development')).not.toThrow();
    expect(() => assertLocalNodeEnvironment('test')).not.toThrow();
    expect(() => assertLocalNodeEnvironment('staging')).toThrow('restricted to NODE_ENV=development or NODE_ENV=test');
    expect(() => assertLocalNodeEnvironment('production')).toThrow('restricted to NODE_ENV=development or NODE_ENV=test');
    expect(() => assertLocalNodeEnvironment(undefined)).toThrow('restricted to NODE_ENV=development or NODE_ENV=test');

    process.env.NODE_ENV = 'staging';
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(runCli([])).resolves.toBe(2);

    expect(stderr).toHaveBeenCalledWith('Historical finance inventory execution failed\n');
    expect(mockedPrismaService).not.toHaveBeenCalled();
  });

  it('passes bounded options, writes an atomic receipt dependency, and prints one aggregate-only summary', async () => {
    const stdout: string[] = [];
    const writeReceipt = jest.fn(async () => undefined);
    const scan = jest.fn(async () => cleanResult());
    const scanStorage = jest.fn(async () => ({ status: 'COMPLETE_CLEAN' as const, counts: {} }));
    const exitCode = await runHistoricalFinanceInventoryCli({
      args: ['--database-batch-size', '25', '--max-findings', '1000', '--output', '/secure/receipt.json'],
      scan,
      scanStorage,
      writeReceipt,
      writeStdout: (message) => stdout.push(message),
    });

    expect(exitCode).toBe(0);
    expect(scan).toHaveBeenCalledWith({ databaseBatchSize: 25, maxFindings: 1000 });
    expect(scanStorage).not.toHaveBeenCalled();
    expect(writeReceipt).toHaveBeenCalledWith('/secure/receipt.json', { finance: cleanResult() });
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0])).toEqual({
      schemaVersion: 'historical-finance-inventory/v1',
      status: 'COMPLETE_CLEAN',
      classificationTotals: { SAFE: 0, LEGACY_SUPPORTED: 0, REPAIRABLE: 0, INVALID_BLOCKING: 0 },
      coverageCounts: cleanResult().coverageCounts,
      pagesRead: 0,
      recordsRead: 0,
      recordedFindings: 0,
      findingsTruncated: false,
    });
  });

  it('reports unavailable storage configuration as an optional aggregate without changing the finance scan', async () => {
    const stdout: string[] = [];
    const writeReceipt = jest.fn(async () => undefined);
    const exitCode = await runHistoricalFinanceInventoryCli({
      args: ['--include-storage', '--output', '/secure/receipt.json'],
      scan: async () => cleanResult(),
      writeReceipt,
      writeStdout: (message) => stdout.push(message),
    });

    expect(exitCode).toBe(0);
    expect(writeReceipt).toHaveBeenCalledWith('/secure/receipt.json', {
      finance: cleanResult(),
      storage: { status: 'SKIPPED_CONFIG_UNAVAILABLE', counts: {} },
    });
    expect(JSON.parse(stdout[0])).toMatchObject({
      status: 'COMPLETE_CLEAN',
      storage: { status: 'SKIPPED_CONFIG_UNAVAILABLE', counts: {} },
    });
  });

  it('uses the supplied historical storage aggregate only when storage is requested', async () => {
    const stdout: string[] = [];
    const storage = {
      status: 'COMPLETE_WITH_FINDINGS' as const,
      counts: { storageEntriesScanned: 2, 'storage:ORPHAN_HISTORICAL_VERSION': 1 },
    };
    const scanStorage = jest.fn(async () => storage);

    const exitCode = await runHistoricalFinanceInventoryCli({
      args: ['--include-storage'],
      scan: async () => cleanResult(),
      scanStorage,
      writeReceipt: async () => undefined,
      writeStdout: (message) => stdout.push(message),
    });

    expect(exitCode).toBe(0);
    expect(scanStorage).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stdout[0])).toMatchObject({ status: 'COMPLETE_CLEAN', storage });
  });

  it('contains an operational storage failure in a distinct redacted aggregate', async () => {
    const stdout: string[] = [];

    const exitCode = await runHistoricalFinanceInventoryCli({
      args: ['--include-storage'],
      scan: async () => cleanResult(),
      scanStorage: async () => Promise.reject(new Error('S3_SECRET_KEY=never-print')),
      writeReceipt: async () => undefined,
      writeStdout: (message) => stdout.push(message),
    });

    expect(exitCode).toBe(2);
    expect(JSON.parse(stdout[0])).toMatchObject({
      status: 'COMPLETE_CLEAN',
      storage: { status: 'INCOMPLETE_OPERATIONAL_ERROR', counts: {}, operationalErrorCode: 'STORAGE_SCAN_FAILED' },
    });
    expect(stdout[0]).not.toContain('S3_SECRET_KEY');
  });

  it('reports a non-sensitive operational result when receipt writing fails', async () => {
    const stdout: string[] = [];
    const exitCode = await runHistoricalFinanceInventoryCli({
      args: ['--output', '/secure/receipt.json'],
      scan: async () => cleanResult(),
      writeReceipt: async () => Promise.reject(new Error('tenant-a record-1 should not escape')),
      writeStdout: (message) => stdout.push(message),
    });

    expect(exitCode).toBe(2);
    expect(JSON.parse(stdout[0])).toEqual({
      schemaVersion: 'historical-finance-inventory/v1',
      status: 'INCOMPLETE_OPERATIONAL_ERROR',
      operationalErrorCode: 'RECEIPT_WRITE_FAILED',
    });
    expect(stdout[0]).not.toContain('tenant-a');
    expect(stdout[0]).not.toContain('record-1');
  });

  it('rejects invalid bounded or detail options and returns non-success for blocking outcomes', async () => {
    const stdout: string[] = [];
    const blocking = { ...cleanResult(), status: 'COMPLETE_WITH_BLOCKING_FINDINGS' as const };
    expect(() => parseHistoricalFinanceInventoryCliOptions(['--database-batch-size', '0']))
      .toThrow(new HistoricalFinanceInventoryCliUsageError('--database-batch-size must be an integer between 1 and 100'));
    expect(() => parseHistoricalFinanceInventoryCliOptions(['--max-findings', '10001']))
      .toThrow(new HistoricalFinanceInventoryCliUsageError('--max-findings must be an integer between 0 and 10000'));
    await expect(runHistoricalFinanceInventoryCli({
      args: ['--show-records'],
      scan: async () => blocking,
      writeReceipt: async () => undefined,
      writeStdout: (message) => stdout.push(message),
    })).rejects.toThrow('Unknown option: --show-records');

    await expect(runHistoricalFinanceInventoryCli({
      args: [],
      scan: async () => blocking,
      writeReceipt: async () => undefined,
      writeStdout: (message) => stdout.push(message),
    })).resolves.toBe(2);
  });
});
