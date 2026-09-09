import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppConfig } from '../../config/config.types';
import { loadConfigOrThrow } from '../../config/config';
import { PrismaService } from '../../prisma/prisma.service';
import { HistoricalInventoryScanner } from './historical-inventory.scanner';
import { HistoricalInventoryReceipt } from './historical-inventory.types';
import {
  assertOperationalNodeEnvironment,
  formatOperationalFailure,
  OperationalFailureCategory,
  OPERATIONAL_PRODUCTION_CONFIRMATION_TOKEN,
  OPERATIONAL_PRODUCTION_CONFIRMATION_VARIABLE,
  OPERATIONAL_STAGING_CONFIRMATION_TOKEN,
  OPERATIONAL_STAGING_CONFIRMATION_VARIABLE,
  runOperationalCli,
} from './historical-inventory.operational';
import { MinioService } from '../../storage/minio.service';

jest.mock('../../config/config', () => ({ loadConfigOrThrow: jest.fn() }));
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: jest.fn() }));
jest.mock('../../storage/minio.service', () => ({ MinioService: jest.fn() }));
jest.mock('./historical-inventory.scanner', () => ({ HistoricalInventoryScanner: jest.fn() }));

const mockedLoadConfig = loadConfigOrThrow as jest.MockedFunction<typeof loadConfigOrThrow>;
const mockedPrismaService = PrismaService as jest.MockedClass<typeof PrismaService>;
const mockedMinioService = MinioService as jest.MockedClass<typeof MinioService>;
const mockedScanner = HistoricalInventoryScanner as jest.MockedClass<typeof HistoricalInventoryScanner>;

function operationalReceipt(): HistoricalInventoryReceipt {
  return {
    schemaVersion: '1.0',
    scannerName: 'historical-object-inventory',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    consistencyModel: 'MOVING_WINDOW',
    databaseRowsScanned: 0,
    databaseReferencesScanned: 0,
    storageEntriesScanned: 0,
    bucketsScanned: 0,
    referenceOutcomeCounts: {
      EXACT_REFERENCED_VERSION_PRESENT: 0,
      EXACT_REFERENCED_VERSION_MISSING: 0,
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
      CURRENT_ORPHAN_OBJECT: 0,
      ORPHAN_HISTORICAL_VERSION: 0,
    },
    dispositionCounts: {
      PRESERVE: 0,
      REPAIR_REQUIRED_LATER: 0,
      OPERATIONAL_ERROR: 0,
    },
    operationalErrorCount: 0,
    scanStatus: 'COMPLETE_CLEAN',
    detailedFindings: [],
  };
}

describe('reconciliation-historical-inventory-operational CLI', () => {
  const originalEnvironment = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnvironment,
      NODE_ENV: 'staging',
      [OPERATIONAL_STAGING_CONFIRMATION_VARIABLE]: OPERATIONAL_STAGING_CONFIRMATION_TOKEN,
    };
    mockedLoadConfig.mockReturnValue({ nodeEnv: 'staging' } as AppConfig);
    mockedPrismaService.mockImplementation(() => ({
      $connect: jest.fn().mockResolvedValue(undefined),
      $disconnect: jest.fn().mockResolvedValue(undefined),
    } as unknown as PrismaService));
    mockedMinioService.mockImplementation(() => ({
      getDefaultBucket: jest.fn().mockReturnValue('historical-inventory'),
    } as unknown as MinioService));
    mockedScanner.mockImplementation(() => ({
      scan: jest.fn().mockResolvedValue(operationalReceipt()),
    } as unknown as HistoricalInventoryScanner));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnvironment;
  });

  it.each([
    ['CONFIG', () => mockedLoadConfig.mockImplementation(() => { throw new Error('DATABASE_URL=postgresql://user:secret@example.test/db'); })],
    ['AUTHORIZATION', () => { delete process.env[OPERATIONAL_STAGING_CONFIRMATION_VARIABLE]; }],
    ['DB_CONNECT', () => mockedPrismaService.mockImplementation(() => ({
      $connect: jest.fn().mockRejectedValue(new Error('password=secret-database-password')),
      $disconnect: jest.fn().mockResolvedValue(undefined),
    } as unknown as PrismaService))],
    ['SCANNER', () => mockedScanner.mockImplementation(() => ({
      scan: jest.fn().mockRejectedValue(new Error('storage-secret=never-print')),
    } as unknown as HistoricalInventoryScanner))],
    ['RECEIPT_WRITE', () => undefined],
  ] as const)('reports %s failures without exposing raw errors', async (phase, configureFailure) => {
    configureFailure();
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const exitCode = await runOperationalCli(phase === 'RECEIPT_WRITE' ? ['--output', '/tmp'] : []);
    const output = stderr.mock.calls.map(([message]) => String(message)).join('');

    expect(exitCode).toBe(2);
    expect(output).toBe(`Operational historical inventory failed [${phase === 'CONFIG' ? 'CONFIG' : phase}]\n`);
    expect(output).not.toContain('secret');
  });

  it('reports cleanup failures without rejecting or exposing provider secrets', async () => {
    mockedPrismaService.mockImplementation(() => ({
      $connect: jest.fn().mockResolvedValue(undefined),
      $disconnect: jest.fn().mockRejectedValue(new Error('postgresql://user:SUPER_SECRET@example/db password=SUPER_SECRET')),
    } as unknown as PrismaService));
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(runOperationalCli([])).resolves.toBe(2);

    const output = stderr.mock.calls.map(([message]) => String(message)).join('');
    expect(output).toBe('Operational historical inventory failed [CLEANUP]\n');
    expect(output).not.toContain('SUPER_SECRET');
    expect(output).not.toContain('postgresql://');
    expect(output).not.toContain('password=');
    expect(output).not.toContain('stack trace');
  });

  it('formats unknown failures without exposing synthetic provider secrets', () => {
    const syntheticError = new Error('postgresql://user:SUPER_SECRET@example/db S3_SECRET_KEY=SUPER_SECRET');
    const output = formatOperationalFailure(OperationalFailureCategory.UNKNOWN);

    expect(output).toBe('Operational historical inventory failed [UNKNOWN]\n');
    expect(output).toContain('UNKNOWN');
    expect(output).not.toContain('SUPER_SECRET');
    expect(output).not.toContain('postgresql://');
    expect(output).not.toContain('S3_SECRET_KEY=');
    expect(output).not.toContain(syntheticError.message);
    expect(output).not.toContain(syntheticError.stack ?? 'stack trace');
  });

  it('returns help before loading configuration or creating providers', async () => {
    await expect(runOperationalCli(['--help'])).resolves.toBe(0);

    expect(mockedLoadConfig).not.toHaveBeenCalled();
    expect(mockedPrismaService).not.toHaveBeenCalled();
    expect(mockedMinioService).not.toHaveBeenCalled();
    expect(mockedScanner).not.toHaveBeenCalled();
  });

  it('denies an unconfirmed environment before creating providers', async () => {
    delete process.env[OPERATIONAL_STAGING_CONFIRMATION_VARIABLE];
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(runOperationalCli([])).resolves.toBe(2);

    expect(stderr).toHaveBeenLastCalledWith('Operational historical inventory failed [AUTHORIZATION]\n');
    expect(mockedPrismaService).not.toHaveBeenCalled();
    expect(mockedMinioService).not.toHaveBeenCalled();
    expect(mockedScanner).not.toHaveBeenCalled();
  });

  it.each([
    [
      'staging',
      {
        NODE_ENV: 'staging',
        [OPERATIONAL_STAGING_CONFIRMATION_VARIABLE]: OPERATIONAL_STAGING_CONFIRMATION_TOKEN,
      },
    ],
    [
      'production',
      {
        NODE_ENV: 'production',
        [OPERATIONAL_PRODUCTION_CONFIRMATION_VARIABLE]: OPERATIONAL_PRODUCTION_CONFIRMATION_TOKEN,
      },
    ],
  ] as const)('authorizes %s only with its matching runtime confirmation', (nodeEnv, environment) => {
    expect(() => assertOperationalNodeEnvironment(nodeEnv, environment)).not.toThrow();
  });

  it.each([
    ['staging', { NODE_ENV: 'staging' }],
    ['staging', { NODE_ENV: 'staging', [OPERATIONAL_STAGING_CONFIRMATION_VARIABLE]: 'wrong' }],
    ['staging', { NODE_ENV: 'staging', [OPERATIONAL_PRODUCTION_CONFIRMATION_VARIABLE]: OPERATIONAL_PRODUCTION_CONFIRMATION_TOKEN }],
    ['production', { NODE_ENV: 'production' }],
    ['production', { NODE_ENV: 'production', [OPERATIONAL_PRODUCTION_CONFIRMATION_VARIABLE]: 'wrong' }],
    ['production', { NODE_ENV: 'production', [OPERATIONAL_STAGING_CONFIRMATION_VARIABLE]: OPERATIONAL_STAGING_CONFIRMATION_TOKEN }],
    ['development', { NODE_ENV: 'development' }],
    ['test', { NODE_ENV: 'test' }],
    ['preview', { NODE_ENV: 'preview' }],
  ] as const)('denies unsupported or unconfirmed %s environments', (nodeEnv, environment) => {
    expect(() => assertOperationalNodeEnvironment(nodeEnv, environment)).toThrow();
  });

  it('denies environment spoofing when configured and runtime NODE_ENV differ', () => {
    expect(() => assertOperationalNodeEnvironment('staging', {
      NODE_ENV: 'production',
      [OPERATIONAL_STAGING_CONFIRMATION_VARIABLE]: OPERATIONAL_STAGING_CONFIRMATION_TOKEN,
    })).toThrow('NODE_ENV=staging');
  });

  it('contains no direct mutation interfaces', async () => {
    const source = await readFile(join(__dirname, 'historical-inventory.operational.ts'), 'utf8');

    expect(source).not.toMatch(/\.(?:create|update|upsert|delete|removeObject|putObject|uploadBuffer|\$executeRaw)\b/u);
    expect(source).toContain('HistoricalInventoryScanner');
    expect(source).toContain('PrismaDbToStorageDatabase');
    expect(source).toContain('MinioService');
    expect(source).toContain("./historical-inventory.operational.shared");
    expect(source).not.toContain('scripts/');
  });
});
