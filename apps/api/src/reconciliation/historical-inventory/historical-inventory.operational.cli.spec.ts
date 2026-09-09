import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  assertOperationalNodeEnvironment,
  OPERATIONAL_PRODUCTION_CONFIRMATION_TOKEN,
  OPERATIONAL_PRODUCTION_CONFIRMATION_VARIABLE,
  OPERATIONAL_STAGING_CONFIRMATION_TOKEN,
  OPERATIONAL_STAGING_CONFIRMATION_VARIABLE,
} from '../../../scripts/reconciliation-historical-inventory-operational';

describe('reconciliation-historical-inventory-operational CLI', () => {
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
    const source = await readFile(join(__dirname, '../../../scripts/reconciliation-historical-inventory-operational.ts'), 'utf8');

    expect(source).not.toMatch(/\.(?:create|update|upsert|delete|removeObject|putObject|uploadBuffer|\$executeRaw)\b/u);
    expect(source).toContain('HistoricalInventoryScanner');
    expect(source).toContain('PrismaDbToStorageDatabase');
    expect(source).toContain('MinioService');
  });
});
