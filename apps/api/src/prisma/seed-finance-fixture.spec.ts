import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  assertSafeHistoricalFixtureDatabase,
  withHistoricalFixtureTriggers,
} from '../../prisma/lib/seed-finance-fixture';

describe('historical finance fixture safety', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('accepts only test environments and disposable test database names', () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://local:local@127.0.0.1:5434/buildingos_phase3d2_test';

    expect(() => assertSafeHistoricalFixtureDatabase()).not.toThrow();
  });

  it.each([
    ['development', 'buildingos_phase3d2_test'],
    ['production', 'buildingos_test'],
  ])('rejects non-test NODE_ENV=%s', (nodeEnv, databaseName) => {
    process.env.NODE_ENV = nodeEnv;
    process.env.DATABASE_URL = `postgresql://local:local@127.0.0.1:5434/${databaseName}`;

    expect(() => assertSafeHistoricalFixtureDatabase()).toThrow('NODE_ENV=test');
  });

  it.each(['buildingos', 'other_db', 'buildingos_local'])(
    'rejects non-disposable database name %s',
    (databaseName) => {
      process.env.NODE_ENV = 'test';
      process.env.DATABASE_URL = `postgresql://local:local@127.0.0.1:5434/${databaseName}`;

      expect(() => assertSafeHistoricalFixtureDatabase()).toThrow('disposable test database');
    },
  );

  it('keeps historical trigger disabling transactionally isolated and restores both triggers on failure', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://local:local@127.0.0.1:5434/buildingos_phase3d2_test';
    const executeRawUnsafe = jest.fn().mockResolvedValue(0);
    const transaction = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ $executeRawUnsafe: executeRawUnsafe }),
    );
    const prisma = { $transaction: transaction } as unknown as PrismaClient;

    await expect(withHistoricalFixtureTriggers(prisma, async () => 'created')).resolves.toBe('created');
    await expect(withHistoricalFixtureTriggers(prisma, async () => {
      throw new Error('fixture failure');
    })).rejects.toThrow('fixture failure');

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(executeRawUnsafe).toHaveBeenCalledTimes(8);
    expect(executeRawUnsafe.mock.calls.filter(([sql]) =>
      String(sql).includes('DISABLE TRIGGER'),
    )).toHaveLength(4);
    expect(executeRawUnsafe.mock.calls.filter(([sql]) =>
      String(sql).includes('ENABLE TRIGGER'),
    )).toHaveLength(4);
  });

  it('keeps the production fixture path free of trigger bypasses', () => {
    const source = readFileSync(join(__dirname, '../../prisma/lib/seed-finance-fixture.ts'), 'utf8');

    expect(source).toContain('return prisma.$transaction(async (tx) =>');
    expect(source).toContain('try {');
    expect(source).toContain('ALTER TABLE "Liquidation" DISABLE TRIGGER "Liquidation_publication_integrity_origin"');
    expect(source).toContain('ALTER TABLE "Liquidation" DISABLE TRIGGER "Liquidation_publication_integrity"');
    expect(source).toContain('ALTER TABLE "Liquidation" ENABLE TRIGGER "Liquidation_publication_integrity"');
    expect(source).toContain('ALTER TABLE "Liquidation" ENABLE TRIGGER "Liquidation_publication_integrity_origin"');
    expect(source).not.toContain('ALLOW_RBAC_BYPASS');
  });
});
