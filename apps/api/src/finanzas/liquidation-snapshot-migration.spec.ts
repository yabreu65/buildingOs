import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('liquidation snapshot migration preflight', () => {
  const migrationPath = join(
    __dirname,
    '../../prisma/migrations/20260711000000_add_liquidation_publication_snapshot/migration.sql',
  );

  it('adds a duplicate preflight before the unique index', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const preflightIndex = migration.indexOf('DO $$');
    const uniqueIndex = migration.indexOf('CREATE UNIQUE INDEX "Liquidation_unique_published_tenant_building_period"');

    expect(preflightIndex).toBeGreaterThanOrEqual(0);
    expect(uniqueIndex).toBeGreaterThan(preflightIndex);
    expect(migration).toContain('WHERE "status" = \'PUBLISHED\'');
    expect(migration).toContain('GROUP BY "tenantId", "buildingId", "period"');
    expect(migration).toContain('HAVING COUNT(*) > 1');
    expect(migration).toContain('END;');
    expect(migration).toContain('NEW."createdAt" IS DISTINCT FROM OLD."createdAt"');
    expect(migration).toContain(
      'cannot create published liquidation uniqueness constraint: duplicate published liquidations exist for tenant, building and period',
    );
  });
});

const migrationSql = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20260711000000_add_liquidation_publication_snapshot/migration.sql',
  ),
  'utf8',
);

const migrationFunctionStart = migrationSql.indexOf('CREATE OR REPLACE FUNCTION enforce_liquidation_publication_snapshot_immutable()');
const migrationTriggerStart = migrationSql.indexOf('CREATE TRIGGER "Liquidation_publicationSnapshot_immutable"');
const migrationFunctionSql =
  migrationFunctionStart >= 0 && migrationTriggerStart > migrationFunctionStart
    ? migrationSql.slice(migrationFunctionStart, migrationTriggerStart).trim()
    : '';

const shouldRunDatabaseBehaviorTests = Boolean(process.env.DATABASE_URL);
const describeDatabaseBehavior = shouldRunDatabaseBehaviorTests ? describe : describe.skip;

describeDatabaseBehavior('liquidation snapshot migration database behavior', () => {
  let prisma: import('@prisma/client').PrismaClient;

  const createTempLiquidationTableSql = `
    CREATE TEMP TABLE "Liquidation" (
      "id" TEXT PRIMARY KEY,
      "tenantId" TEXT NOT NULL,
      "buildingId" TEXT NOT NULL,
      "period" TEXT NOT NULL,
      "chargePeriod" TEXT,
      "status" TEXT NOT NULL,
      "baseCurrency" TEXT NOT NULL,
      "totalAmountMinor" BIGINT NOT NULL,
      "totalsByCurrency" JSONB NOT NULL,
      "expenseSnapshot" JSONB NOT NULL,
      "unitCount" INTEGER NOT NULL,
      "generatedByMembershipId" TEXT NOT NULL,
      "generatedAt" TIMESTAMPTZ NOT NULL,
      "reviewedByMembershipId" TEXT,
      "reviewedAt" TIMESTAMPTZ,
      "publishedByMembershipId" TEXT,
      "publishedAt" TIMESTAMPTZ,
      "canceledByMembershipId" TEXT,
      "canceledAt" TIMESTAMPTZ,
      "publicationSnapshot" JSONB,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    ) ON COMMIT DROP;
  `;

  const createTempTriggerSql = `
    CREATE TRIGGER "Liquidation_publicationSnapshot_immutable"
    BEFORE INSERT OR UPDATE ON "Liquidation"
    FOR EACH ROW
    EXECUTE FUNCTION enforce_liquidation_publication_snapshot_immutable();
  `;

  const createTempUniqueIndexSql = `
    CREATE UNIQUE INDEX "Liquidation_unique_published_tenant_building_period"
    ON "Liquidation" ("tenantId", "buildingId", "period")
    WHERE "status" = 'PUBLISHED';
  `;

  beforeAll(async () => {
    const prismaModule = await import('@prisma/client');
    prisma = new prismaModule.PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function withSandbox<T>(action: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(createTempLiquidationTableSql);
      if (!migrationFunctionSql) {
        throw new Error('Could not extract liquidation snapshot trigger function SQL');
      }
      await tx.$executeRawUnsafe(migrationFunctionSql);
      await tx.$executeRawUnsafe(createTempTriggerSql);
      await tx.$executeRawUnsafe(createTempUniqueIndexSql);
      return action(tx);
    });
  }

  async function publishLiquidationInSandbox(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    liquidationId: string,
    period: string,
    publishedAt: string,
  ): Promise<void> {
    await tx.$executeRawUnsafe(`
      INSERT INTO "Liquidation" (
        "id", "tenantId", "buildingId", "period", "chargePeriod", "status",
        "baseCurrency", "totalAmountMinor", "totalsByCurrency", "expenseSnapshot",
        "unitCount", "generatedByMembershipId", "generatedAt", "createdAt", "updatedAt"
      ) VALUES (
        '${liquidationId}', 'tenant-1', 'building-1', '${period}', '2026-06', 'DRAFT',
        'ARS', 100, '{"ARS":100}', '[]',
        2, 'member-1', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'
      );
    `);

    await tx.$executeRawUnsafe(`
      UPDATE "Liquidation"
      SET "status" = 'REVIEWED',
          "reviewedAt" = '2026-05-02T00:00:00.000Z',
          "reviewedByMembershipId" = 'member-1',
          "updatedAt" = '2026-05-02T00:00:00.000Z'
      WHERE "id" = '${liquidationId}';
    `);

    await tx.$executeRawUnsafe(`
      UPDATE "Liquidation"
      SET "status" = 'PUBLISHED',
          "publicationSnapshot" = '{"version":1,"liquidationId":"${liquidationId}","tenantId":"tenant-1","buildingId":"building-1","period":"${period}","baseCurrency":"ARS","totalAmountMinor":100,"totalsByCurrency":{"ARS":100},"expenses":[],"allocations":[],"dueDate":"2026-06-10T00:00:00.000Z","publishedAt":"${publishedAt}"}',
          "publishedAt" = '${publishedAt}',
          "publishedByMembershipId" = 'member-1',
          "updatedAt" = '${publishedAt}'
      WHERE "id" = '${liquidationId}';
    `);
  }

  it('allows the expected draft, review and publication lifecycle in PostgreSQL', async () => {
    await withSandbox(async (tx) => {
      await tx.$executeRawUnsafe(`
        INSERT INTO "Liquidation" (
          "id", "tenantId", "buildingId", "period", "chargePeriod", "status",
          "baseCurrency", "totalAmountMinor", "totalsByCurrency", "expenseSnapshot",
          "unitCount", "generatedByMembershipId", "generatedAt", "createdAt", "updatedAt"
        ) VALUES (
          'liq-1', 'tenant-1', 'building-1', '2026-05', '2026-06', 'DRAFT',
          'ARS', 100, '{"ARS":100}', '[]',
          2, 'member-1', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'
        );
      `);

      await tx.$executeRawUnsafe(`
        UPDATE "Liquidation"
        SET "status" = 'REVIEWED',
            "reviewedAt" = '2026-05-02T00:00:00.000Z',
            "reviewedByMembershipId" = 'member-1',
            "updatedAt" = '2026-05-02T00:00:00.000Z'
        WHERE "id" = 'liq-1';
      `);

      await tx.$executeRawUnsafe(`
        UPDATE "Liquidation"
        SET "status" = 'PUBLISHED',
            "publicationSnapshot" = '{"version":1,"liquidationId":"liq-1","tenantId":"tenant-1","buildingId":"building-1","period":"2026-05","baseCurrency":"ARS","totalAmountMinor":100,"totalsByCurrency":{"ARS":100},"expenses":[],"allocations":[],"dueDate":"2026-06-10T00:00:00.000Z","publishedAt":"2026-05-03T00:00:00.000Z"}',
            "publishedAt" = '2026-05-03T00:00:00.000Z',
            "publishedByMembershipId" = 'member-1',
            "updatedAt" = '2026-05-03T00:00:00.000Z'
        WHERE "id" = 'liq-1';
      `);

      const rows = await tx.$queryRawUnsafe<Array<{ status: string; publicationSnapshot: unknown }>>(
        `SELECT "status", "publicationSnapshot" FROM "Liquidation" WHERE "id" = 'liq-1';`,
      );

      expect(rows[0]?.status).toBe('PUBLISHED');
      expect(rows[0]?.publicationSnapshot).not.toBeNull();
    });
  });

  it('rejects a direct draft to published transition in PostgreSQL', async () => {
    await expect(
      withSandbox(async (tx) => {
        await tx.$executeRawUnsafe(`
          INSERT INTO "Liquidation" (
            "id", "tenantId", "buildingId", "period", "chargePeriod", "status",
            "baseCurrency", "totalAmountMinor", "totalsByCurrency", "expenseSnapshot",
            "unitCount", "generatedByMembershipId", "generatedAt", "createdAt", "updatedAt"
          ) VALUES (
            'liq-2', 'tenant-1', 'building-1', '2026-05', '2026-06', 'DRAFT',
            'ARS', 100, '{"ARS":100}', '[]',
            2, 'member-1', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'
          );
        `);

        await tx.$executeRawUnsafe(`
          UPDATE "Liquidation"
          SET "status" = 'PUBLISHED',
              "publicationSnapshot" = '{"version":1,"liquidationId":"liq-2","tenantId":"tenant-1","buildingId":"building-1","period":"2026-05","baseCurrency":"ARS","totalAmountMinor":100,"totalsByCurrency":{"ARS":100},"expenses":[],"allocations":[],"dueDate":"2026-06-10T00:00:00.000Z","publishedAt":"2026-05-03T00:00:00.000Z"}',
              "publishedAt" = '2026-05-03T00:00:00.000Z',
              "publishedByMembershipId" = 'member-1',
              "updatedAt" = '2026-05-03T00:00:00.000Z'
          WHERE "id" = 'liq-2';
        `);
      }),
    ).rejects.toThrow();
  });

  it('rejects immutable createdAt changes on published liquidations in PostgreSQL', async () => {
    await expect(
      withSandbox(async (tx) => {
        await publishLiquidationInSandbox(tx, 'liq-3', '2026-05', '2026-05-03T00:00:00.000Z');

        await tx.$executeRawUnsafe(`
          UPDATE "Liquidation"
          SET "createdAt" = '2026-05-04T00:00:00.000Z'
          WHERE "id" = 'liq-3';
        `);
      }),
    ).rejects.toThrow();
  });

  it('rejects duplicate published liquidations in PostgreSQL', async () => {
    await expect(
      withSandbox(async (tx) => {
        await publishLiquidationInSandbox(tx, 'liq-4', '2026-05', '2026-05-03T00:00:00.000Z');

        await tx.$executeRawUnsafe(`
          INSERT INTO "Liquidation" (
            "id", "tenantId", "buildingId", "period", "chargePeriod", "status",
            "baseCurrency", "totalAmountMinor", "totalsByCurrency", "expenseSnapshot",
            "unitCount", "generatedByMembershipId", "generatedAt", "createdAt", "updatedAt"
          ) VALUES (
            'liq-5', 'tenant-1', 'building-1', '2026-05', '2026-06', 'DRAFT',
            'ARS', 100, '{"ARS":100}', '[]',
            2, 'member-1', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'
          );
        `);

        await tx.$executeRawUnsafe(`
          UPDATE "Liquidation"
          SET "status" = 'REVIEWED',
              "reviewedAt" = '2026-05-02T00:00:00.000Z',
              "reviewedByMembershipId" = 'member-1',
              "updatedAt" = '2026-05-02T00:00:00.000Z'
          WHERE "id" = 'liq-5';
        `);

        await tx.$executeRawUnsafe(`
          UPDATE "Liquidation"
          SET "status" = 'PUBLISHED',
              "publicationSnapshot" = '{"version":1,"liquidationId":"liq-5","tenantId":"tenant-1","buildingId":"building-1","period":"2026-05","baseCurrency":"ARS","totalAmountMinor":100,"totalsByCurrency":{"ARS":100},"expenses":[],"allocations":[],"dueDate":"2026-06-10T00:00:00.000Z","publishedAt":"2026-05-03T00:00:00.000Z"}',
              "publishedAt" = '2026-05-03T00:00:00.000Z',
              "publishedByMembershipId" = 'member-1',
              "updatedAt" = '2026-05-03T00:00:00.000Z'
          WHERE "id" = 'liq-5';
        `);
      }),
    ).rejects.toThrow();
  });
});
