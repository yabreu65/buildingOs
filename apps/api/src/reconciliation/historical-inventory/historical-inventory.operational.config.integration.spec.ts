import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../../storage/minio.service';
import { HistoricalInventoryScanner } from './historical-inventory.scanner';
import { runOperationalCli } from './historical-inventory.operational';

jest.mock('../../prisma/prisma.service', () => ({ PrismaService: jest.fn() }));
jest.mock('../../storage/minio.service', () => ({ MinioService: jest.fn() }));
jest.mock('./historical-inventory.scanner', () => ({ HistoricalInventoryScanner: jest.fn() }));

const mockedPrismaService = PrismaService as jest.MockedClass<typeof PrismaService>;
const mockedMinioService = MinioService as jest.MockedClass<typeof MinioService>;
const mockedScanner = HistoricalInventoryScanner as jest.MockedClass<typeof HistoricalInventoryScanner>;

function stagingEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'staging',
    HISTORICAL_INVENTORY_OPERATIONAL_STAGING_CONFIRMATION: 'HISTORICAL-INVENTORY-STAGING-READ-ONLY',
    DATABASE_URL: 'postgresql://audit-user:VERY_SECRET_PASSWORD@db.example.test:5432/audit',
    JWT_SECRET: 'a'.repeat(64),
    JWT_EXPIRES_IN: '7d',
    WEB_ORIGIN: 'https://web.example.test',
    APP_BASE_URL: 'https://web.example.test',
    S3_ENDPOINT: 'https://storage.example.test',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'audit-access-key',
    S3_SECRET_KEY: 'VERY_SECRET_S3_KEY',
    S3_BUCKET: 'audit-bucket',
    S3_FORCE_PATH_STYLE: 'true',
    S3_PUBLIC_BASE_URL: 'https://storage.example.test/audit-bucket',
    FEATURE_PORTAL_RESIDENT: 'false',
    FEATURE_PAYMENTS_MVP: 'false',
    MAIL_PROVIDER: 'none',
    PAYMENT_PROVIDER: 'none',
    AI_PROVIDER: 'none',
    ENABLE_WEB_PUSH: 'false',
  };
}

function expectSanitizedConfigFailure(output: string): void {
  expect(output).toBe('Operational historical inventory failed [CONFIG]\n');
  expect(output).not.toContain('VERY_SECRET_PASSWORD');
  expect(output).not.toContain('VERY_SECRET_S3_KEY');
  expect(output).not.toContain('postgresql://');
  expect(output).not.toContain('DATABASE_URL');
  expect(output).not.toContain('JWT_SECRET');
  expect(output).not.toContain('S3_SECRET_KEY');
  expect(output).not.toContain('stack');
}

describe('operational CLI real configuration failure path', () => {
  const originalEnvironment = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = stagingEnvironment();
  });

  afterEach(() => {
    process.env = originalEnvironment;
    jest.restoreAllMocks();
  });

  it('maps a real schema validation failure to a sanitized CONFIG result', async () => {
    delete process.env.WEB_ORIGIN;
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await expect(runOperationalCli([])).resolves.toBe(2);

    expectSanitizedConfigFailure(stderr.mock.calls.map(([message]) => String(message)).join(''));
    expect(exit).not.toHaveBeenCalled();
    expect(mockedPrismaService).not.toHaveBeenCalled();
    expect(mockedMinioService).not.toHaveBeenCalled();
    expect(mockedScanner).not.toHaveBeenCalled();
  });

  it('maps a real staging conditional validation failure to a sanitized CONFIG result', async () => {
    process.env.JWT_SECRET = 'a'.repeat(40);
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await expect(runOperationalCli([])).resolves.toBe(2);

    expectSanitizedConfigFailure(stderr.mock.calls.map(([message]) => String(message)).join(''));
    expect(exit).not.toHaveBeenCalled();
    expect(mockedPrismaService).not.toHaveBeenCalled();
    expect(mockedMinioService).not.toHaveBeenCalled();
    expect(mockedScanner).not.toHaveBeenCalled();
  });
});
