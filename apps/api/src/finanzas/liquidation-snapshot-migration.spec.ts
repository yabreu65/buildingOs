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

const phase3d2MigrationSql = readFileSync(
  join(__dirname, '../../prisma/migrations/20260913000000_add_phase3d2_publication_integrity/migration.sql'),
  'utf8',
);

function triggerFunctionSql(functionName: string, triggerName: string): string {
  const start = phase3d2MigrationSql.indexOf(`CREATE OR REPLACE FUNCTION ${functionName}()`);
  const trigger = phase3d2MigrationSql.indexOf(`DROP TRIGGER IF EXISTS "${triggerName}"`);
  return start >= 0 && trigger > start ? phase3d2MigrationSql.slice(start, trigger).trim() : '';
}

const liquidationTriggerSql = triggerFunctionSql(
  'enforce_liquidation_publication_integrity',
  'Liquidation_publication_integrity',
);
const chargeTriggerSql = triggerFunctionSql(
  'enforce_liquidation_generated_charge_immutable',
  'Charge_liquidation_generated_immutable',
);
const describePhase3d2Postgres =
  Boolean(process.env.DATABASE_URL) && process.env.RUN_POSTGRES_INTEGRATION === '1'
    ? describe
    : describe.skip;

describe('FASE 3D.2 trigger migration preflight', () => {
  it('extracts the actual functions used by the PostgreSQL sandbox', () => {
    expect(liquidationTriggerSql).toContain("RAISE EXCEPTION 'modern liquidation identity and evidence are immutable'");
    expect(liquidationTriggerSql).toContain("RAISE EXCEPTION 'published liquidations cannot be updated'");
    expect(liquidationTriggerSql).toContain("RAISE EXCEPTION 'published liquidations cannot be deleted'");
    expect(liquidationTriggerSql).toContain("RAISE EXCEPTION 'liquidation publicationIntegrityVersion is immutable after insert'");
    expect(liquidationTriggerSql).toContain("RAISE EXCEPTION 'modern liquidation publication requires matching V4 integrity evidence'");
    expect(chargeTriggerSql).toContain("RAISE EXCEPTION 'liquidation-generated charge economic origin is immutable'");
    expect(chargeTriggerSql).toContain("RAISE EXCEPTION 'manual charges cannot acquire liquidationId'");
    expect(chargeTriggerSql).toContain("RAISE EXCEPTION 'liquidation-generated charges cannot be deleted'");
  });
});

describePhase3d2Postgres('FASE 3D.2 PostgreSQL trigger behavior', () => {
  let prisma: import('@prisma/client').PrismaClient;
  type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

  const liquidationTableSql = `
    CREATE TEMP TABLE "Liquidation" (
      "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "buildingId" TEXT NOT NULL, "period" TEXT NOT NULL,
      "chargePeriod" TEXT, "status" TEXT NOT NULL, "publicationIntegrityVersion" INTEGER, "valuationMode" TEXT,
      "baseCurrency" TEXT NOT NULL, "totalAmountMinor" BIGINT NOT NULL, "totalsByCurrency" JSONB NOT NULL,
      "expenseSnapshot" JSONB NOT NULL, "distributionSnapshot" JSONB, "unitCount" INTEGER NOT NULL,
      "generatedByMembershipId" TEXT NOT NULL, "generatedAt" TIMESTAMPTZ NOT NULL, "reviewedByMembershipId" TEXT,
      "reviewedAt" TIMESTAMPTZ, "publishedByMembershipId" TEXT, "publishedAt" TIMESTAMPTZ,
      "canceledByMembershipId" TEXT, "canceledAt" TIMESTAMPTZ, "publicationSnapshot" JSONB,
      "grossExpenseAmountMinor" BIGINT, "adjustmentAmountMinor" BIGINT, "preIncomeAmountMinor" BIGINT,
      "incomeOffsetAmountMinor" BIGINT, "netDistributableAmountMinor" BIGINT, "incomeOffsetSnapshot" JSONB,
      "incomeOffsetsByCurrency" JSONB, "createdAt" TIMESTAMPTZ NOT NULL, "updatedAt" TIMESTAMPTZ NOT NULL
    ) ON COMMIT DROP;
  `;
  const chargeTableSql = `
    CREATE TEMP TABLE "Charge" (
      "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "buildingId" TEXT NOT NULL, "unitId" TEXT NOT NULL,
      "period" TEXT NOT NULL, "chargePeriod" TEXT, "type" TEXT NOT NULL, "concept" TEXT NOT NULL,
      "amount" BIGINT NOT NULL, "remainingAmount" BIGINT NOT NULL, "currency" TEXT NOT NULL,
      "dueDate" TIMESTAMPTZ NOT NULL, "status" TEXT NOT NULL, "liquidationId" TEXT,
      "createdByMembershipId" TEXT, "periodId" TEXT, "coefficientSnapshot" JSONB, "sumCoefSnapshot" BIGINT,
      "totalToAllocateSnapshot" BIGINT, "categorySnapshotId" TEXT, "canceledAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL, "updatedAt" TIMESTAMPTZ NOT NULL
    ) ON COMMIT DROP;
  `;

  beforeAll(async () => {
    const prismaModule = await import('@prisma/client');
    prisma = new prismaModule.PrismaClient();
    await prisma.$connect();
    const [database] = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
    const expectedDatabaseName = process.env.POSTGRES_TEST_DB_NAME;
    if (!database?.current_database || database.current_database === 'buildingos') {
      throw new Error('Refusing to run PostgreSQL trigger tests against buildingos');
    }
    if (expectedDatabaseName && database.current_database !== expectedDatabaseName) {
      throw new Error(`Refusing to run against unexpected database ${database.current_database}; expected ${expectedDatabaseName}`);
    }
  });
  afterAll(async () => prisma?.$disconnect());

  async function sandbox<T>(action: (tx: TransactionClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      if (!liquidationTriggerSql || !chargeTriggerSql) throw new Error('Could not extract FASE 3D.2 trigger function SQL');
      await tx.$executeRawUnsafe(liquidationTableSql);
      await tx.$executeRawUnsafe(chargeTableSql);
      await tx.$executeRawUnsafe(liquidationTriggerSql);
      await tx.$executeRawUnsafe(chargeTriggerSql);
      await tx.$executeRawUnsafe(`
        CREATE TRIGGER "Liquidation_publication_integrity" BEFORE INSERT OR UPDATE OR DELETE ON "Liquidation" FOR EACH ROW EXECUTE FUNCTION enforce_liquidation_publication_integrity();
      `);
      await tx.$executeRawUnsafe(`
        CREATE TRIGGER "Charge_liquidation_generated_immutable" BEFORE UPDATE OR DELETE ON "Charge" FOR EACH ROW EXECUTE FUNCTION enforce_liquidation_generated_charge_immutable();
      `);
      return action(tx);
    });
  }

  async function insertLiquidation(tx: TransactionClient, id: string): Promise<void> {
    await tx.$executeRawUnsafe(`
      INSERT INTO "Liquidation" ("id", "tenantId", "buildingId", "period", "chargePeriod", "status", "publicationIntegrityVersion", "valuationMode", "baseCurrency", "totalAmountMinor", "totalsByCurrency", "expenseSnapshot", "distributionSnapshot", "unitCount", "generatedByMembershipId", "generatedAt", "grossExpenseAmountMinor", "adjustmentAmountMinor", "preIncomeAmountMinor", "incomeOffsetAmountMinor", "netDistributableAmountMinor", "incomeOffsetSnapshot", "incomeOffsetsByCurrency", "createdAt", "updatedAt")
      VALUES ('${id}', 'tenant-1', 'building-1', '2026-05', '2026-06', 'DRAFT', 1, 'LEGACY_NOMINAL', 'ARS', 100, '{"ARS":100}', '[]', '[]', 2, 'member-1', '2026-05-01T00:00:00Z', 100, 0, 100, 0, 100, '[]', '{"ARS":0}', '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z');
    `);
  }
  async function publish(tx: TransactionClient, id: string): Promise<void> {
    await insertLiquidation(tx, id);
    await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'REVIEWED', "reviewedByMembershipId" = 'member-1', "reviewedAt" = '2026-05-02T00:00:00Z' WHERE "id" = '${id}'`);
    await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'PUBLISHED', "publicationSnapshot" = '{"version":4,"period":"2026-05","chargePeriod":"2026-06","publicationIntegrityVersion":1}', "publishedByMembershipId" = 'member-1', "publishedAt" = '2026-05-03T00:00:00Z' WHERE "id" = '${id}'`);
  }
  async function insertCharge(tx: TransactionClient, id: string, liquidationId: string | null): Promise<void> {
    const liquidationValue = liquidationId === null ? 'NULL' : `'${liquidationId}'`;
    await tx.$executeRawUnsafe(`
      INSERT INTO "Charge" ("id", "tenantId", "buildingId", "unitId", "period", "chargePeriod", "type", "concept", "amount", "remainingAmount", "currency", "dueDate", "status", "liquidationId", "createdByMembershipId", "periodId", "coefficientSnapshot", "sumCoefSnapshot", "totalToAllocateSnapshot", "categorySnapshotId", "createdAt", "updatedAt")
      VALUES ('${id}', 'tenant-1', 'building-1', 'unit-1', '2026-05', '2026-06', 'EXPENSE', 'Monthly liquidation', 100, 100, 'ARS', '2026-06-10T00:00:00Z', 'PENDING', ${liquidationValue}, 'member-1', 'period-1', '{"coefficient":1}', 1, 100, 'category-1', '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z');
    `);
  }

  it('allows modern Liquidation lifecycle metadata transitions', async () => {
    await sandbox(async (tx) => {
      await insertLiquidation(tx, 'lifecycle');
      await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'REVIEWED', "reviewedByMembershipId" = 'member-1', "reviewedAt" = '2026-05-02T00:00:00Z', "updatedAt" = '2026-05-02T00:00:00Z' WHERE "id" = 'lifecycle'`);
      await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'CANCELED', "canceledByMembershipId" = 'member-1', "canceledAt" = '2026-05-03T00:00:00Z', "updatedAt" = '2026-05-03T00:00:00Z' WHERE "id" = 'lifecycle'`);
      expect(await tx.$queryRawUnsafe(`SELECT "status" FROM "Liquidation" WHERE "id" = 'lifecycle'`)).toEqual([{ status: 'CANCELED' }]);
    });
  });

  it('rejects modern Liquidation core/evidence mutations and every published mutation', async () => {
    await expect(sandbox(async (tx) => { await insertLiquidation(tx, 'core'); await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "period" = '2026-07' WHERE "id" = 'core'`); })).rejects.toThrow('modern liquidation identity and evidence are immutable');
    await expect(sandbox(async (tx) => { await insertLiquidation(tx, 'evidence'); await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "totalAmountMinor" = 101 WHERE "id" = 'evidence'`); })).rejects.toThrow('modern liquidation identity and evidence are immutable');
    await expect(sandbox(async (tx) => { await publish(tx, 'published-update'); await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "updatedAt" = '2026-05-04T00:00:00Z' WHERE "id" = 'published-update'`); })).rejects.toThrow('published liquidations cannot be updated');
    await expect(sandbox(async (tx) => { await publish(tx, 'published-delete'); await tx.$executeRawUnsafe(`DELETE /* intentional trigger test */ FROM "Liquidation" WHERE "id" = 'published-delete'`); })).rejects.toThrow('published liquidations cannot be deleted');
  });

  it('rejects legacy integrity promotion, invalid state reversal, and mismatched modern chargePeriod', async () => {
    await expect(sandbox(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO "Liquidation" ("id", "tenantId", "buildingId", "period", "chargePeriod", "status", "baseCurrency", "totalAmountMinor", "totalsByCurrency", "expenseSnapshot", "unitCount", "generatedByMembershipId", "generatedAt", "createdAt", "updatedAt") VALUES ('legacy-promotion', 'tenant-1', 'building-1', '2026-05', '2026-06', 'DRAFT', 'ARS', 100, '{"ARS":100}', '[]', 2, 'member-1', '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z')`);
      await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "publicationIntegrityVersion" = 1 WHERE "id" = 'legacy-promotion'`);
    })).rejects.toThrow('liquidation publicationIntegrityVersion is immutable after insert');
    await expect(sandbox(async (tx) => {
      await insertLiquidation(tx, 'review-reversal');
      await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'REVIEWED', "reviewedByMembershipId" = 'member-1', "reviewedAt" = '2026-05-02T00:00:00Z' WHERE "id" = 'review-reversal'`);
      await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'DRAFT' WHERE "id" = 'review-reversal'`);
    })).rejects.toThrow('invalid liquidation status transition');
    await expect(sandbox(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO "Liquidation" ("id", "tenantId", "buildingId", "period", "chargePeriod", "status", "publicationIntegrityVersion", "valuationMode", "baseCurrency", "totalAmountMinor", "totalsByCurrency", "expenseSnapshot", "distributionSnapshot", "unitCount", "generatedByMembershipId", "generatedAt", "createdAt", "updatedAt") VALUES ('bad-charge-period', 'tenant-1', 'building-1', '2026-05', '2026-07', 'DRAFT', 1, 'LEGACY_NOMINAL', 'ARS', 100, '{"ARS":100}', '[]', '[]', 2, 'member-1', '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z')`);
    })).rejects.toThrow('publication integrity v1 drafts require next chargePeriod');
  });

  it('rejects modern V2 publication snapshots', async () => {
    await expect(sandbox(async (tx) => {
      await insertLiquidation(tx, 'modern-v2');
      await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'REVIEWED', "reviewedByMembershipId" = 'member-1', "reviewedAt" = '2026-05-02T00:00:00Z' WHERE "id" = 'modern-v2'`);
      await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'PUBLISHED', "publicationSnapshot" = '{"version":2}', "publishedByMembershipId" = 'member-1', "publishedAt" = '2026-05-03T00:00:00Z' WHERE "id" = 'modern-v2'`);
    })).rejects.toThrow('modern liquidation publication requires matching V4 integrity evidence');
  });

  it('rejects liquidation-generated Charge economic changes/deletion but allows operational fields', async () => {
    await expect(sandbox(async (tx) => { await insertCharge(tx, 'economic', 'liq-1'); await tx.$executeRawUnsafe(`UPDATE "Charge" SET "amount" = 101 WHERE "id" = 'economic'`); })).rejects.toThrow('liquidation-generated charge economic origin is immutable');
    await expect(sandbox(async (tx) => { await insertCharge(tx, 'generated-delete', 'liq-1'); await tx.$executeRawUnsafe(`DELETE /* intentional trigger test */ FROM "Charge" WHERE "id" = 'generated-delete'`); })).rejects.toThrow('liquidation-generated charges cannot be deleted');
    await sandbox(async (tx) => {
      await insertCharge(tx, 'operational', 'liq-1');
      await tx.$executeRawUnsafe(`UPDATE "Charge" SET "status" = 'CANCELED', "remainingAmount" = 0, "canceledAt" = '2026-05-04T00:00:00Z', "updatedAt" = '2026-05-04T00:00:00Z' WHERE "id" = 'operational'`);
      expect(await tx.$queryRawUnsafe(`SELECT "status", "remainingAmount", "canceledAt", "updatedAt" FROM "Charge" WHERE "id" = 'operational'`)).toEqual([expect.objectContaining({ status: 'CANCELED', remainingAmount: BigInt(0), canceledAt: expect.any(Date), updatedAt: expect.any(Date) })]);
    });
  });

  it('allows manual Charges with null liquidationId to be mutable and deletable', async () => {
    await sandbox(async (tx) => {
      await insertCharge(tx, 'manual', null);
      await tx.$executeRawUnsafe(`UPDATE "Charge" SET "amount" = 101 WHERE "id" = 'manual'`);
      await tx.$executeRawUnsafe(`DELETE /* intentional trigger test */ FROM "Charge" WHERE "id" = 'manual'`);
      expect(await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "Charge" WHERE "id" = 'manual'`)).toEqual([{ count: 0 }]);
    });
  });

  it('rejects manual Charges acquiring a liquidationId', async () => {
    await expect(sandbox(async (tx) => {
      await insertCharge(tx, 'manual-promotion', null);
      await tx.$executeRawUnsafe(`UPDATE "Charge" SET "liquidationId" = 'liq-1' WHERE "id" = 'manual-promotion'`);
    })).rejects.toThrow('manual charges cannot acquire liquidationId');
  });
});
