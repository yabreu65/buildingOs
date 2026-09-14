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

const parentCascadeMigrationSql = readFileSync(
  join(__dirname, '../../prisma/migrations/20260914000000_allow_authorized_parent_cascades/migration.sql'),
  'utf8',
);

function triggerFunctionSql(functionName: string, triggerName: string): string {
  const start = parentCascadeMigrationSql.indexOf(`CREATE OR REPLACE FUNCTION ${functionName}()`);
  const trigger = parentCascadeMigrationSql.indexOf(`DROP TRIGGER IF EXISTS "${triggerName}"`);
  return start >= 0 && trigger > start ? parentCascadeMigrationSql.slice(start, trigger).trim() : '';
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

describe('authorized parent cascade trigger migration preflight', () => {
  it('extracts the actual functions used by the PostgreSQL sandbox', () => {
    expect(liquidationTriggerSql).toContain("RAISE EXCEPTION 'modern liquidation identity and evidence are immutable'");
    expect(liquidationTriggerSql).toContain("RAISE EXCEPTION 'published liquidations cannot be updated'");
    expect(liquidationTriggerSql).toContain("RAISE EXCEPTION 'published liquidations cannot be deleted'");
    expect(liquidationTriggerSql).toContain('EXISTS (SELECT 1 FROM "Tenant" WHERE "id" = OLD."tenantId")');
    expect(liquidationTriggerSql).toContain('EXISTS (SELECT 1 FROM "Building" WHERE "id" = OLD."buildingId")');
    expect(liquidationTriggerSql).not.toContain('pg_trigger_depth');
    expect(liquidationTriggerSql).toContain("RAISE EXCEPTION 'liquidation publicationIntegrityVersion is immutable after insert'");
    expect(liquidationTriggerSql).toContain("RAISE EXCEPTION 'modern liquidation publication requires complete matching V4 evidence'");
    expect(liquidationTriggerSql).toContain("NEW.\"publicationSnapshot\" ->> 'liquidationId' IS DISTINCT FROM NEW.\"id\"");
    expect(liquidationTriggerSql).toContain("NEW.\"publicationSnapshot\" -> 'incomeOffsets' IS DISTINCT FROM NEW.\"incomeOffsetSnapshot\"");
    expect(liquidationTriggerSql).toContain('jsonb_array_elements(NEW."publicationSnapshot" -> \'expenses\')');
    expect(liquidationTriggerSql).toContain('jsonb_each(NEW."publicationSnapshot" -> \'totalsByCurrency\')');
    expect(liquidationTriggerSql).toContain("'tenantId', \"tenantId\"");
    expect(liquidationTriggerSql).toContain("'dueDate', snapshotDueDate AT TIME ZONE 'UTC'");
        expect(liquidationTriggerSql).toContain("'dueDate', \"dueDate\"");
    expect(liquidationTriggerSql).toContain('jsonb_array_elements(NEW."publicationSnapshot" -> \'allocations\')');
        expect(liquidationTriggerSql).toContain('FROM "Charge"');
        expect(chargeTriggerSql).toContain("RAISE EXCEPTION 'liquidation-generated charge economic origin is immutable'");
        expect(chargeTriggerSql).toContain('FROM "Membership" WHERE "id" = OLD."createdByMembershipId"');
    expect(chargeTriggerSql).toContain("RAISE EXCEPTION 'manual charges cannot acquire liquidationId'");
    expect(chargeTriggerSql).toContain("RAISE EXCEPTION 'liquidation-generated charges cannot be deleted'");
    expect(chargeTriggerSql).toContain('OLD."canceledAt" IS NOT NULL');
    expect(chargeTriggerSql).toContain('NOT EXISTS (SELECT 1 FROM "Unit" WHERE "id" = OLD."unitId")');
    expect(chargeTriggerSql).not.toContain('pg_trigger_depth');
  });
});

describePhase3d2Postgres('authorized parent cascade PostgreSQL trigger behavior', () => {
  let prisma: import('@prisma/client').PrismaClient;
  type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

  const tenantTableSql = `
    CREATE TEMP TABLE "Tenant" (
      "id" TEXT PRIMARY KEY
    ) ON COMMIT DROP;
  `;
  const buildingTableSql = `
    CREATE TEMP TABLE "Building" (
      "id" TEXT PRIMARY KEY,
      "tenantId" TEXT NOT NULL REFERENCES "Tenant" ("id") ON DELETE CASCADE
    ) ON COMMIT DROP;
  `;
  const unitTableSql = `
    CREATE TEMP TABLE "Unit" (
      "id" TEXT PRIMARY KEY,
      "tenantId" TEXT NOT NULL REFERENCES "Tenant" ("id") ON DELETE CASCADE,
      "buildingId" TEXT NOT NULL REFERENCES "Building" ("id") ON DELETE CASCADE
    ) ON COMMIT DROP;
  `;
  const membershipTableSql = `
        CREATE TEMP TABLE "Membership" (
          "id" TEXT PRIMARY KEY
        ) ON COMMIT DROP;
      `;
      const liquidationTableSql = `
    CREATE TEMP TABLE "Liquidation" (
      "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "Tenant" ("id") ON DELETE CASCADE, "buildingId" TEXT NOT NULL REFERENCES "Building" ("id") ON DELETE CASCADE, "period" TEXT NOT NULL,
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
      "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL REFERENCES "Tenant" ("id") ON DELETE CASCADE, "buildingId" TEXT NOT NULL REFERENCES "Building" ("id") ON DELETE CASCADE, "unitId" TEXT NOT NULL REFERENCES "Unit" ("id") ON DELETE CASCADE,
      "period" TEXT NOT NULL, "chargePeriod" TEXT, "type" TEXT NOT NULL, "concept" TEXT NOT NULL,
      "amount" BIGINT NOT NULL, "remainingAmount" BIGINT NOT NULL, "currency" TEXT NOT NULL,
      "dueDate" TIMESTAMP(3) NOT NULL, "status" TEXT NOT NULL, "liquidationId" TEXT,
      "createdByMembershipId" TEXT REFERENCES "Membership" ("id") ON DELETE SET NULL, "periodId" TEXT, "coefficientSnapshot" JSONB, "sumCoefSnapshot" BIGINT,
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
      if (!liquidationTriggerSql || !chargeTriggerSql) throw new Error('Could not extract authorized parent cascade trigger function SQL');
      await tx.$executeRawUnsafe(tenantTableSql);
      await tx.$executeRawUnsafe(buildingTableSql);
      await tx.$executeRawUnsafe(unitTableSql);
          await tx.$executeRawUnsafe(membershipTableSql);
      await tx.$executeRawUnsafe(liquidationTableSql);
      await tx.$executeRawUnsafe(chargeTableSql);
      await tx.$executeRawUnsafe(`
        INSERT INTO "Tenant" ("id") VALUES ('tenant-1');
      `);
      await tx.$executeRawUnsafe(`
        INSERT INTO "Building" ("id", "tenantId") VALUES ('building-1', 'tenant-1');
      `);
      await tx.$executeRawUnsafe(`
        INSERT INTO "Unit" ("id", "tenantId", "buildingId") VALUES ('unit-1', 'tenant-1', 'building-1');
      `);
      await tx.$executeRawUnsafe(`
            INSERT INTO "Membership" ("id") VALUES ('member-1');
          `);
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

  async function insertLiquidation(
    tx: TransactionClient,
    id: string,
    tenantId = 'tenant-1',
    buildingId = 'building-1',
  ): Promise<void> {
    await tx.$executeRawUnsafe(`
      INSERT INTO "Liquidation" ("id", "tenantId", "buildingId", "period", "chargePeriod", "status", "publicationIntegrityVersion", "valuationMode", "baseCurrency", "totalAmountMinor", "totalsByCurrency", "expenseSnapshot", "distributionSnapshot", "unitCount", "generatedByMembershipId", "generatedAt", "grossExpenseAmountMinor", "adjustmentAmountMinor", "preIncomeAmountMinor", "incomeOffsetAmountMinor", "netDistributableAmountMinor", "incomeOffsetSnapshot", "incomeOffsetsByCurrency", "createdAt", "updatedAt")
      VALUES ('${id}', '${tenantId}', '${buildingId}', '2026-05', '2026-06', 'DRAFT', 1, 'LEGACY_NOMINAL', 'ARS', 100, '{"ARS":100}', '[]', '[]', 2, 'member-1', '2026-05-01T00:00:00Z', 100, 0, 100, 0, 100, '[]', '{}', '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z');
    `);
  }
  function completeV4PublicationSnapshot(
    id: string,
    tenantId: string,
    buildingId: string,
  ): string {
    return JSON.stringify({
      version: 4,
      liquidationId: id,
      tenantId,
      buildingId,
      period: '2026-05',
      chargePeriod: '2026-06',
      publicationIntegrityVersion: 1,
      valuationMode: 'LEGACY_NOMINAL',
      baseCurrency: 'ARS',
      totalAmountMinor: 100,
      totalsByCurrency: { ARS: 100 },
      grossExpenseAmountMinor: 100,
      adjustmentAmountMinor: 0,
      preIncomeAmountMinor: 100,
      incomeOffsetAmountMinor: 0,
      netDistributableAmountMinor: 100,
      incomeOffsetsByCurrency: {},
      expenses: [{
        expenseId: 'expense-1',
        categoryName: 'Common expenses',
        vendorName: null,
        amountMinor: 100,
        currencyCode: 'ARS',
        invoiceDate: '2026-05-01',
        description: null,
        type: 'EXPENSE',
      }],
      incomeOffsets: [],
      allocations: [{ unitId: 'unit-1', unitCode: '1', unitLabel: null, amountMinor: 100 }],
      dueDate: '2026-06-10T00:00:00.000Z',
      publishedAt: '2026-05-03T00:00:00.000Z',
    });
  }

  async function publish(
    tx: TransactionClient,
    id: string,
    tenantId = 'tenant-1',
    buildingId = 'building-1',
  ): Promise<void> {
    await insertLiquidation(tx, id, tenantId, buildingId);
    await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'REVIEWED', "reviewedByMembershipId" = 'member-1', "reviewedAt" = '2026-05-02T00:00:00Z' WHERE "id" = '${id}'`);
    await insertCharge(tx, `charge-${id}`, id, tenantId, buildingId);
        const publicationSnapshot = completeV4PublicationSnapshot(id, tenantId, buildingId);
    await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'PUBLISHED', "publicationSnapshot" = '${publicationSnapshot}', "publishedByMembershipId" = 'member-1', "publishedAt" = '2026-05-03T00:00:00Z' WHERE "id" = '${id}'`);
  }
  interface ChargeInsertOverrides {
    readonly period?: string;
    readonly chargePeriod?: string;
    readonly currency?: string;
    readonly dueDate?: string;
  }

  async function insertCharge(
    tx: TransactionClient,
    id: string,
    liquidationId: string | null,
    tenantId = 'tenant-1',
    buildingId = 'building-1',
    unitId = 'unit-1',
    canceledAt: string | null = null,
    amount = 100,
    overrides: ChargeInsertOverrides = {},
  ): Promise<void> {
    const liquidationValue = liquidationId === null ? 'NULL' : `'${liquidationId}'`;
    const canceledAtValue = canceledAt === null ? 'NULL' : `'${canceledAt}'`;
    const period = overrides.period ?? '2026-05';
    const chargePeriod = overrides.chargePeriod ?? '2026-06';
    const currency = overrides.currency ?? 'ARS';
    const dueDate = overrides.dueDate ?? '2026-06-10T00:00:00Z';
    await tx.$executeRawUnsafe(`
      INSERT INTO "Charge" ("id", "tenantId", "buildingId", "unitId", "period", "chargePeriod", "type", "concept", "amount", "remainingAmount", "currency", "dueDate", "status", "liquidationId", "createdByMembershipId", "periodId", "coefficientSnapshot", "sumCoefSnapshot", "totalToAllocateSnapshot", "categorySnapshotId", "canceledAt", "createdAt", "updatedAt")
      VALUES ('${id}', '${tenantId}', '${buildingId}', '${unitId}', '${period}', '${chargePeriod}', 'EXPENSE', 'Monthly liquidation', ${amount}, ${amount}, '${currency}', '${dueDate}', 'PENDING', ${liquidationValue}, 'member-1', 'period-1', '{"coefficient":1}', 1, 100, 'category-1', ${canceledAtValue}, '2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z');
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

  it('allows a tenant cascade to remove published Liquidations and generated Charges while unrelated data survives', async () => {
    await sandbox(async (tx) => {
      await tx.$executeRawUnsafe(`
        INSERT INTO "Tenant" ("id") VALUES ('tenant-cascade'), ('tenant-unrelated');
      `);
      await tx.$executeRawUnsafe(`
        INSERT INTO "Building" ("id", "tenantId") VALUES ('building-cascade', 'tenant-cascade'), ('building-unrelated', 'tenant-unrelated');
      `);
      await tx.$executeRawUnsafe(`
        INSERT INTO "Unit" ("id", "tenantId", "buildingId") VALUES ('unit-cascade', 'tenant-cascade', 'building-cascade'), ('unit-unrelated', 'tenant-unrelated', 'building-unrelated');
      `);
      await publish(tx, 'liquidation-cascade', 'tenant-cascade', 'building-cascade');
      await insertCharge(tx, 'charge-cascade', 'liquidation-cascade', 'tenant-cascade', 'building-cascade', 'unit-cascade');
      await publish(tx, 'liquidation-unrelated', 'tenant-unrelated', 'building-unrelated');
      await insertCharge(tx, 'charge-unrelated', 'liquidation-unrelated', 'tenant-unrelated', 'building-unrelated', 'unit-unrelated');

      await tx.$executeRawUnsafe(`DELETE /* intentional cascade test */ FROM "Tenant" WHERE "id" = 'tenant-cascade'`);

      expect(await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "Liquidation" WHERE "id" = 'liquidation-cascade'`)).toEqual([{ count: 0 }]);
      expect(await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "Charge" WHERE "id" = 'charge-cascade'`)).toEqual([{ count: 0 }]);
      expect(await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "Tenant" WHERE "id" = 'tenant-unrelated'`)).toEqual([{ count: 1 }]);
      expect(await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "Liquidation" WHERE "id" = 'liquidation-unrelated'`)).toEqual([{ count: 1 }]);
      expect(await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "Charge" WHERE "id" = 'charge-unrelated'`)).toEqual([{ count: 1 }]);
    });
  });

  it('allows a building cascade to remove a published Liquidation while its tenant remains', async () => {
    await sandbox(async (tx) => {
      await publish(tx, 'liquidation-building-cascade');

      await tx.$executeRawUnsafe(`DELETE /* intentional cascade test */ FROM "Building" WHERE "id" = 'building-1'`);

      expect(await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "Liquidation" WHERE "id" = 'liquidation-building-cascade'`)).toEqual([{ count: 0 }]);
      expect(await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "Tenant" WHERE "id" = 'tenant-1'`)).toEqual([{ count: 1 }]);
    });
  });

  it('rejects an active generated Charge when its Unit is deleted by cascade', async () => {
    await expect(sandbox(async (tx) => {
      await insertCharge(tx, 'active-unit-cascade', 'liq-1');
      await tx.$executeRawUnsafe(`DELETE /* intentional cascade test */ FROM "Unit" WHERE "id" = 'unit-1'`);
    })).rejects.toThrow('liquidation-generated charges cannot be deleted');
  });

  it('allows a canceled generated Charge to be removed by a Unit cascade while unrelated data survives', async () => {
    await sandbox(async (tx) => {
      await tx.$executeRawUnsafe(`
        INSERT INTO "Tenant" ("id") VALUES ('tenant-unrelated');
      `);
      await tx.$executeRawUnsafe(`
        INSERT INTO "Building" ("id", "tenantId") VALUES ('building-unrelated', 'tenant-unrelated');
      `);
      await tx.$executeRawUnsafe(`
        INSERT INTO "Unit" ("id", "tenantId", "buildingId") VALUES ('unit-unrelated', 'tenant-unrelated', 'building-unrelated');
      `);
      await insertCharge(tx, 'canceled-unit-cascade', 'liq-1', 'tenant-1', 'building-1', 'unit-1', '2026-05-04T00:00:00Z');
      await insertCharge(tx, 'charge-unrelated', 'liq-2', 'tenant-unrelated', 'building-unrelated', 'unit-unrelated');

      await tx.$executeRawUnsafe(`DELETE /* intentional cascade test */ FROM "Unit" WHERE "id" = 'unit-1'`);

      expect(await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "Charge" WHERE "id" = 'canceled-unit-cascade'`)).toEqual([{ count: 0 }]);
      expect(await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "Unit" WHERE "id" = 'unit-unrelated'`)).toEqual([{ count: 1 }]);
      expect(await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "Charge" WHERE "id" = 'charge-unrelated'`)).toEqual([{ count: 1 }]);
    });
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

  it('requires a complete reconciled V4 snapshot and accepts the workflow Charge timestamp shape for modern publication', async () => {
    await expect(sandbox(async (tx) => {
      await insertLiquidation(tx, 'modern-incomplete');
      await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'REVIEWED', "reviewedByMembershipId" = 'member-1', "reviewedAt" = '2026-05-02T00:00:00Z' WHERE "id" = 'modern-incomplete'`);
      await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'PUBLISHED', "publicationSnapshot" = '{"version":4,"period":"2026-05","chargePeriod":"2026-06","publicationIntegrityVersion":1}', "publishedByMembershipId" = 'member-1', "publishedAt" = '2026-05-03T00:00:00Z' WHERE "id" = 'modern-incomplete'`);
    })).rejects.toThrow('modern liquidation publication requires complete matching V4 evidence');

    await expect(sandbox(async (tx) => {
      await insertLiquidation(tx, 'modern-mismatched');
      await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'REVIEWED', "reviewedByMembershipId" = 'member-1', "reviewedAt" = '2026-05-02T00:00:00Z' WHERE "id" = 'modern-mismatched'`);
      const publicationSnapshot = completeV4PublicationSnapshot('modern-mismatched', 'tenant-1', 'building-1')
        .replace('"totalAmountMinor":100', '"totalAmountMinor":101');
      await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'PUBLISHED', "publicationSnapshot" = '${publicationSnapshot}', "publishedByMembershipId" = 'member-1', "publishedAt" = '2026-05-03T00:00:00Z' WHERE "id" = 'modern-mismatched'`);
    })).rejects.toThrow('modern liquidation publication requires complete matching V4 evidence');

    await sandbox(async (tx) => {
      await publish(tx, 'modern-valid');
      expect(await tx.$queryRawUnsafe(`SELECT "status" FROM "Liquidation" WHERE "id" = 'modern-valid'`)).toEqual([{ status: 'PUBLISHED' }]);
    });
  });

  it('rejects empty, malformed, or currency-inconsistent expense evidence for modern V4 publication', async () => {
        await expect(sandbox(async (tx) => {
          await insertLiquidation(tx, 'modern-empty-expenses');
          await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'REVIEWED', "reviewedByMembershipId" = 'member-1', "reviewedAt" = '2026-05-02T00:00:00Z' WHERE "id" = 'modern-empty-expenses'`);
          await insertCharge(tx, 'charge-modern-empty-expenses', 'modern-empty-expenses');
          const publicationSnapshot = completeV4PublicationSnapshot('modern-empty-expenses', 'tenant-1', 'building-1')
            .replace('"expenses":[{"expenseId":"expense-1","categoryName":"Common expenses","vendorName":null,"amountMinor":100,"currencyCode":"ARS","invoiceDate":"2026-05-01","description":null,"type":"EXPENSE"}]', '"expenses":[]');
          await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'PUBLISHED', "publicationSnapshot" = '${publicationSnapshot}', "publishedByMembershipId" = 'member-1', "publishedAt" = '2026-05-03T00:00:00Z' WHERE "id" = 'modern-empty-expenses'`);
        })).rejects.toThrow('modern liquidation publication requires complete matching V4 evidence');

        await expect(sandbox(async (tx) => {
          await insertLiquidation(tx, 'modern-malformed-expense');
          await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'REVIEWED', "reviewedByMembershipId" = 'member-1', "reviewedAt" = '2026-05-02T00:00:00Z' WHERE "id" = 'modern-malformed-expense'`);
          await insertCharge(tx, 'charge-modern-malformed-expense', 'modern-malformed-expense');
          const publicationSnapshot = completeV4PublicationSnapshot('modern-malformed-expense', 'tenant-1', 'building-1')
            .replace('"categoryName":"Common expenses"', '"categoryName":""');
          await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'PUBLISHED', "publicationSnapshot" = '${publicationSnapshot}', "publishedByMembershipId" = 'member-1', "publishedAt" = '2026-05-03T00:00:00Z' WHERE "id" = 'modern-malformed-expense'`);
        })).rejects.toThrow('modern liquidation publication requires complete matching V4 evidence');

        await expect(sandbox(async (tx) => {
          await insertLiquidation(tx, 'modern-inconsistent-expense-totals');
          await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'REVIEWED', "reviewedByMembershipId" = 'member-1', "reviewedAt" = '2026-05-02T00:00:00Z' WHERE "id" = 'modern-inconsistent-expense-totals'`);
          await insertCharge(tx, 'charge-modern-inconsistent-expense-totals', 'modern-inconsistent-expense-totals');
          const publicationSnapshot = completeV4PublicationSnapshot('modern-inconsistent-expense-totals', 'tenant-1', 'building-1')
            .replace('"amountMinor":100,"currencyCode":"ARS"', '"amountMinor":99,"currencyCode":"ARS"');
          await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'PUBLISHED', "publicationSnapshot" = '${publicationSnapshot}', "publishedByMembershipId" = 'member-1', "publishedAt" = '2026-05-03T00:00:00Z' WHERE "id" = 'modern-inconsistent-expense-totals'`);
        })).rejects.toThrow('modern liquidation publication requires complete matching V4 evidence');

        await sandbox(async (tx) => {
          await publish(tx, 'modern-complete-expenses');
          expect(await tx.$queryRawUnsafe(`SELECT "status" FROM "Liquidation" WHERE "id" = 'modern-complete-expenses'`)).toEqual([{ status: 'PUBLISHED' }]);
        });
      });

      it('rejects generated Charges whose ownership and economic tuple differs from the V4 snapshot', async () => {
        const mismatches: ReadonlyArray<{
          readonly name: string;
          readonly tenantId: string;
          readonly buildingId: string;
          readonly liquidationId?: string;
          readonly amount: number;
          readonly overrides: ChargeInsertOverrides;
        }> = [
          { name: 'tenant', tenantId: 'tenant-2', buildingId: 'building-1', amount: 100, overrides: {} },
          { name: 'building', tenantId: 'tenant-1', buildingId: 'building-2', amount: 100, overrides: {} },
          { name: 'period', tenantId: 'tenant-1', buildingId: 'building-1', amount: 100, overrides: { period: '2026-04' } },
          { name: 'charge-period', tenantId: 'tenant-1', buildingId: 'building-1', amount: 100, overrides: { chargePeriod: '2026-07' } },
          { name: 'currency', tenantId: 'tenant-1', buildingId: 'building-1', amount: 100, overrides: { currency: 'USD' } },
          { name: 'due-date', tenantId: 'tenant-1', buildingId: 'building-1', amount: 100, overrides: { dueDate: '2026-06-11T00:00:00Z' } },
          { name: 'liquidation-id', tenantId: 'tenant-1', buildingId: 'building-1', liquidationId: 'other-liquidation', amount: 100, overrides: {} },
          { name: 'non-payable', tenantId: 'tenant-1', buildingId: 'building-1', amount: 0, overrides: {} },
        ];

        for (const mismatch of mismatches) {
          await expect(sandbox(async (tx) => {
            await tx.$executeRawUnsafe(`INSERT INTO "Tenant" ("id") VALUES ('tenant-2')`);
            await tx.$executeRawUnsafe(`INSERT INTO "Building" ("id", "tenantId") VALUES ('building-2', 'tenant-1')`);
            await insertLiquidation(tx, `modern-charge-${mismatch.name}`);
            await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'REVIEWED', "reviewedByMembershipId" = 'member-1', "reviewedAt" = '2026-05-02T00:00:00Z' WHERE "id" = 'modern-charge-${mismatch.name}'`);
            await insertCharge(
              tx,
              `charge-modern-charge-${mismatch.name}`,
              mismatch.liquidationId ?? `modern-charge-${mismatch.name}`,
              mismatch.tenantId,
              mismatch.buildingId,
              'unit-1',
              null,
              mismatch.amount,
              mismatch.overrides,
            );
            const publicationSnapshot = completeV4PublicationSnapshot(`modern-charge-${mismatch.name}`, 'tenant-1', 'building-1');
            await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'PUBLISHED', "publicationSnapshot" = '${publicationSnapshot}', "publishedByMembershipId" = 'member-1', "publishedAt" = '2026-05-03T00:00:00Z' WHERE "id" = 'modern-charge-${mismatch.name}'`);
          })).rejects.toThrow('modern liquidation publication requires complete matching V4 evidence');
        }

        await sandbox(async (tx) => {
          await publish(tx, 'modern-matching-charge-tuple');
          expect(await tx.$queryRawUnsafe(`SELECT "status" FROM "Liquidation" WHERE "id" = 'modern-matching-charge-tuple'`)).toEqual([{ status: 'PUBLISHED' }]);
        });
      });

      it('requires non-empty allocations reconciled to the total and generated Charges for modern V4 publication', async () => {
        await expect(sandbox(async (tx) => {
          await insertLiquidation(tx, 'modern-empty-allocations');
          await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'REVIEWED', "reviewedByMembershipId" = 'member-1', "reviewedAt" = '2026-05-02T00:00:00Z' WHERE "id" = 'modern-empty-allocations'`);
          await insertCharge(tx, 'charge-modern-empty-allocations', 'modern-empty-allocations');
          const publicationSnapshot = completeV4PublicationSnapshot('modern-empty-allocations', 'tenant-1', 'building-1')
            .replace('"allocations":[{"unitId":"unit-1","unitCode":"1","unitLabel":null,"amountMinor":100}]', '"allocations":[]');
          await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'PUBLISHED', "publicationSnapshot" = '${publicationSnapshot}', "publishedByMembershipId" = 'member-1', "publishedAt" = '2026-05-03T00:00:00Z' WHERE "id" = 'modern-empty-allocations'`);
        })).rejects.toThrow('modern liquidation publication requires complete matching V4 evidence');

        await expect(sandbox(async (tx) => {
          await insertLiquidation(tx, 'modern-mismatched-allocations');
          await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'REVIEWED', "reviewedByMembershipId" = 'member-1', "reviewedAt" = '2026-05-02T00:00:00Z' WHERE "id" = 'modern-mismatched-allocations'`);
          await insertCharge(tx, 'charge-modern-mismatched-allocations', 'modern-mismatched-allocations');
          const publicationSnapshot = completeV4PublicationSnapshot('modern-mismatched-allocations', 'tenant-1', 'building-1')
            .replace('"unitLabel":null,"amountMinor":100', '"unitLabel":null,"amountMinor":99');
          await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'PUBLISHED', "publicationSnapshot" = '${publicationSnapshot}', "publishedByMembershipId" = 'member-1', "publishedAt" = '2026-05-03T00:00:00Z' WHERE "id" = 'modern-mismatched-allocations'`);
        })).rejects.toThrow('modern liquidation publication requires complete matching V4 evidence');

        await expect(sandbox(async (tx) => {
          await insertLiquidation(tx, 'modern-mismatched-charges');
          await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'REVIEWED', "reviewedByMembershipId" = 'member-1', "reviewedAt" = '2026-05-02T00:00:00Z' WHERE "id" = 'modern-mismatched-charges'`);
          await insertCharge(tx, 'charge-modern-mismatched-charges', 'modern-mismatched-charges', 'tenant-1', 'building-1', 'unit-1', null, 99);
          const publicationSnapshot = completeV4PublicationSnapshot('modern-mismatched-charges', 'tenant-1', 'building-1');
          await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'PUBLISHED', "publicationSnapshot" = '${publicationSnapshot}', "publishedByMembershipId" = 'member-1', "publishedAt" = '2026-05-03T00:00:00Z' WHERE "id" = 'modern-mismatched-charges'`);
        })).rejects.toThrow('modern liquidation publication requires complete matching V4 evidence');

        await sandbox(async (tx) => {
          await publish(tx, 'modern-matching-allocations');
          expect(await tx.$queryRawUnsafe(`SELECT "status" FROM "Liquidation" WHERE "id" = 'modern-matching-allocations'`)).toEqual([{ status: 'PUBLISHED' }]);
        });
      });

      it('rejects modern V2 publication snapshots', async () => {
    await expect(sandbox(async (tx) => {
      await insertLiquidation(tx, 'modern-v2');
      await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'REVIEWED', "reviewedByMembershipId" = 'member-1', "reviewedAt" = '2026-05-02T00:00:00Z' WHERE "id" = 'modern-v2'`);
      await tx.$executeRawUnsafe(`UPDATE "Liquidation" SET "status" = 'PUBLISHED', "publicationSnapshot" = '{"version":2}', "publishedByMembershipId" = 'member-1', "publishedAt" = '2026-05-03T00:00:00Z' WHERE "id" = 'modern-v2'`);
    })).rejects.toThrow('modern liquidation publication requires complete matching V4 evidence');
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

  it('allows a Membership FK ON DELETE SET NULL on generated Charges but rejects direct provenance changes', async () => {
        await expect(sandbox(async (tx) => {
          await insertCharge(tx, 'generated-membership-direct-change', 'liq-1');
          await tx.$executeRawUnsafe(`UPDATE "Charge" SET "createdByMembershipId" = NULL WHERE "id" = 'generated-membership-direct-change'`);
        })).rejects.toThrow('liquidation-generated charge economic origin is immutable');

        await sandbox(async (tx) => {
          await insertCharge(tx, 'generated-membership-cascade', 'liq-1');
          await tx.$executeRawUnsafe(`DELETE /* intentional FK action test */ FROM "Membership" WHERE "id" = 'member-1'`);
          expect(await tx.$queryRawUnsafe(`SELECT "createdByMembershipId" FROM "Charge" WHERE "id" = 'generated-membership-cascade'`)).toEqual([{ createdByMembershipId: null }]);
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
