import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// This suite executes the real SQL functions in an isolated transaction against
// temporary tables. Enable it only with RUN_POSTGRES_INTEGRATION=1 and a
// dedicated disposable database named by POSTGRES_TEST_DB_NAME. It is not a
// substitute for applying the complete 97→107 migration sequence.
const enabled =
  Boolean(process.env.DATABASE_URL) && process.env.RUN_POSTGRES_INTEGRATION === '1';
const describePostgres = enabled ? describe : describe.skip;

const migration104Sql = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20260916000000_harden_phase3d2_distribution_integrity/migration.sql',
  ),
  'utf8',
);
const migration107Sql = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20260919000000_release_a_dual_liquidation_compatibility/migration.sql',
  ),
  'utf8',
);

function extractFunction(sql: string, functionDeclaration: string): string {
  const start = sql.indexOf(functionDeclaration);
  const end = sql.indexOf('\n$$;', start);
  return start >= 0 && end > start ? sql.slice(start, end + 4).trim() : '';
}

const distributionValidatorSql = extractFunction(
  migration104Sql,
  'CREATE OR REPLACE FUNCTION validate_liquidation_distribution_snapshot(',
);
const compatibilityFunctionSql = extractFunction(
  migration107Sql,
  'CREATE OR REPLACE FUNCTION enforce_liquidation_publication_integrity()',
);
const compatibilityOriginFunctionSql = extractFunction(
  migration107Sql,
  'CREATE OR REPLACE FUNCTION enforce_liquidation_publication_integrity_origin()',
);

const createSandboxTablesSql = [
  'CREATE TEMP TABLE "Tenant" ("id" TEXT PRIMARY KEY) ON COMMIT DROP;',
  `CREATE TEMP TABLE "Building" (
    "id" TEXT PRIMARY KEY,
    "tenantId" TEXT NOT NULL
  ) ON COMMIT DROP;`,
  `CREATE TEMP TABLE "Unit" (
    "id" TEXT PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT
  ) ON COMMIT DROP;`,
  `CREATE TEMP TABLE "Liquidation" (
    "id" TEXT PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "chargePeriod" TEXT,
    "status" TEXT NOT NULL,
    "publicationIntegrityVersion" INTEGER,
    "valuationMode" TEXT,
    "baseCurrency" TEXT NOT NULL,
    "totalAmountMinor" BIGINT NOT NULL,
    "totalsByCurrency" JSONB NOT NULL,
    "expenseSnapshot" JSONB NOT NULL,
    "distributionSnapshot" JSONB,
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
    "grossExpenseAmountMinor" BIGINT,
    "adjustmentAmountMinor" BIGINT,
    "preIncomeAmountMinor" BIGINT,
    "incomeOffsetAmountMinor" BIGINT,
    "netDistributableAmountMinor" BIGINT,
    "incomeOffsetSnapshot" JSONB,
    "incomeOffsetsByCurrency" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL
  ) ON COMMIT DROP;`,
] as const;

interface Allocation {
  readonly unitId: string;
  readonly unitCode: string;
  readonly unitLabel: string | null;
  readonly amountMinor: number;
}

type TransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const timestamp = '2026-05-01T00:00:00.000Z';
const totalAmountMinor = 100;
const tenantId = 'tenant-1';
const buildingId = 'building-1';
const validAllocations: readonly Allocation[] = [
  { unitId: 'unit-1', unitCode: '1', unitLabel: null, amountMinor: 50 },
  { unitId: 'unit-2', unitCode: '2', unitLabel: 'Suite 2', amountMinor: 50 },
];

function distributionSnapshot(
  allocations: readonly Allocation[],
  ownerTenantId = tenantId,
  ownerBuildingId = buildingId,
): Record<string, unknown> {
  return {
    version: 1,
    tenantId: ownerTenantId,
    buildingId: ownerBuildingId,
    totalAmountMinor,
    movements: [{
      movementId: 'movement-1',
      scope: 'BUILDING',
      unitGroupId: null,
      amountMinor: totalAmountMinor,
      weightSource: 'EQUAL',
      totalWeight: String(allocations.length),
      recipientUnitIds: allocations.map((allocation) => allocation.unitId),
      recipients: allocations.map((allocation) => ({
        unitId: allocation.unitId,
        unitCode: allocation.unitCode,
        unitLabel: allocation.unitLabel,
        coefficient: null,
        m2: null,
        weight: '1',
      })),
      allocations,
    }],
    allocations,
  };
}

function v3PublicationSnapshot(id: string): Record<string, unknown> {
  return {
    version: 3,
    valuationMode: 'LEGACY_NOMINAL',
    liquidationId: id,
    tenantId,
    buildingId,
    period: '2026-05',
    baseCurrency: 'ARS',
    totalAmountMinor,
    totalsByCurrency: { ARS: totalAmountMinor },
    grossExpenseAmountMinor: totalAmountMinor,
    adjustmentAmountMinor: 0,
    preIncomeAmountMinor: totalAmountMinor,
    incomeOffsetAmountMinor: 0,
    netDistributableAmountMinor: totalAmountMinor,
    incomeOffsetsByCurrency: {},
    expenses: [{
      expenseId: 'expense-1',
      categoryName: 'Common expenses',
      vendorName: null,
      amountMinor: totalAmountMinor,
      currencyCode: 'ARS',
      invoiceDate: '2026-05-01',
      description: null,
      type: 'EXPENSE',
    }],
    incomeOffsets: [],
    allocations: validAllocations,
    dueDate: '2026-06-10T00:00:00.000Z',
    publishedAt: '2026-05-03T00:00:00.000Z',
  };
}

function v4PublicationSnapshot(
  id: string,
  allocations: readonly Allocation[] = validAllocations,
): Record<string, unknown> {
  return {
    version: 4,
    liquidationId: id,
    tenantId,
    buildingId,
    period: '2026-05',
    chargePeriod: '2026-06',
    publicationIntegrityVersion: 1,
    valuationMode: 'LEGACY_NOMINAL',
    baseCurrency: 'ARS',
    totalAmountMinor,
    totalsByCurrency: { ARS: totalAmountMinor },
    grossExpenseAmountMinor: totalAmountMinor,
    adjustmentAmountMinor: 0,
    preIncomeAmountMinor: totalAmountMinor,
    incomeOffsetAmountMinor: 0,
    netDistributableAmountMinor: totalAmountMinor,
    incomeOffsetsByCurrency: {},
    expenses: [],
    incomeOffsets: [],
    allocations,
    dueDate: '2026-06-10T00:00:00.000Z',
    publishedAt: '2026-05-03T00:00:00.000Z',
  };
}

describePostgres('Release A dual-liquidation compatibility migration PostgreSQL', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
    }
    const expectedDatabaseName = process.env.POSTGRES_TEST_DB_NAME;
    if (!expectedDatabaseName) {
      throw new Error(
        'Refusing PostgreSQL integration tests without POSTGRES_TEST_DB_NAME for a dedicated disposable database',
      );
    }
    if (!distributionValidatorSql || !compatibilityFunctionSql || !compatibilityOriginFunctionSql) {
      throw new Error('Could not extract the required migration 104/107 PostgreSQL functions');
    }

    prisma = new PrismaClient();
    await prisma.$connect();
    const [database] = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT current_database() AS name
    `;
    if (!database?.name || database.name === 'buildingos') {
      throw new Error('Refusing PostgreSQL migration tests against buildingos or an unknown database');
    }
    if (database.name !== expectedDatabaseName) {
      throw new Error(
        `Refusing to run against unexpected database ${database.name}; expected ${expectedDatabaseName}`,
      );
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function withSandbox<T>(action: (tx: TransactionClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      // Keep tables and migration functions in this connection's temporary
      // schema. A passing or failing case rolls back all DDL and fixture rows.
      await tx.$executeRawUnsafe('SET LOCAL search_path = pg_temp, public');
      for (const statement of createSandboxTablesSql) {
        await tx.$executeRawUnsafe(statement);
      }
      await tx.$executeRawUnsafe(distributionValidatorSql);
      await tx.$executeRawUnsafe(compatibilityFunctionSql);
      await tx.$executeRawUnsafe(compatibilityOriginFunctionSql);
      await tx.$executeRawUnsafe(`
        CREATE TRIGGER "Liquidation_publication_integrity"
        BEFORE INSERT OR UPDATE OR DELETE ON "Liquidation"
        FOR EACH ROW EXECUTE FUNCTION enforce_liquidation_publication_integrity();
      `);
      await tx.$executeRawUnsafe(`
        CREATE TRIGGER "Liquidation_publication_integrity_origin"
        BEFORE INSERT OR UPDATE ON "Liquidation"
        FOR EACH ROW EXECUTE FUNCTION enforce_liquidation_publication_integrity_origin();
      `);
      await insertReferenceRows(tx);
      return action(tx);
    });
  }

  async function insertReferenceRows(tx: TransactionClient): Promise<void> {
    await tx.$executeRawUnsafe(`
      INSERT INTO "Tenant" ("id") VALUES ('tenant-1'), ('tenant-2');
    `);
    await tx.$executeRawUnsafe(`
      INSERT INTO "Building" ("id", "tenantId") VALUES
        ('building-1', 'tenant-1'), ('building-2', 'tenant-1'), ('building-foreign', 'tenant-2');
    `);
    await tx.$executeRawUnsafe(`
      INSERT INTO "Unit" ("id", "tenantId", "buildingId", "code", "label") VALUES
        ('unit-1', 'tenant-1', 'building-1', '1', NULL),
        ('unit-2', 'tenant-1', 'building-1', '2', 'Suite 2'),
        ('unit-other-tenant', 'tenant-2', 'building-foreign', 'X', NULL),
        ('unit-other-building', 'tenant-1', 'building-2', 'Y', NULL);
    `);
  }

  async function insertLiquidation(
    tx: TransactionClient,
    id: string,
    options: {
      readonly modern?: boolean;
      readonly allocations?: readonly Allocation[];
      readonly distributionTenantId?: string;
      readonly distributionBuildingId?: string;
    } = {},
  ): Promise<void> {
    const modern = options.modern ?? true;
    const allocations = options.allocations ?? validAllocations;
    const distribution = JSON.stringify(
      distributionSnapshot(
        allocations,
        options.distributionTenantId,
        options.distributionBuildingId,
      ),
    );
    const integrityVersion = modern ? '1' : 'NULL';
    const valuationMode = modern ? "'LEGACY_NOMINAL'" : 'NULL';
    const distributionValue = modern ? `'${distribution}'::jsonb` : 'NULL';
    await tx.$executeRawUnsafe(`
      INSERT INTO "Liquidation" (
        "id", "tenantId", "buildingId", "period", "chargePeriod", "status",
        "publicationIntegrityVersion", "valuationMode", "baseCurrency", "totalAmountMinor",
        "totalsByCurrency", "expenseSnapshot", "distributionSnapshot", "unitCount",
        "generatedByMembershipId", "generatedAt", "createdAt", "updatedAt"
      ) VALUES (
        '${id}', '${tenantId}', '${buildingId}', '2026-05', '2026-06', 'DRAFT',
        ${integrityVersion}, ${valuationMode}, 'ARS', ${totalAmountMinor},
        '{"ARS":${totalAmountMinor}}'::jsonb, '[]'::jsonb, ${distributionValue}, 2,
        'member-1', '${timestamp}', '${timestamp}', '${timestamp}'
      );
    `);
  }

  it('allows a legacy NULL-integrity draft INSERT and the pinned old runtime V3 publication transition', async () => {
    await withSandbox(async (tx) => {
      await insertLiquidation(tx, 'legacy-v3', { modern: false });
      await tx.$executeRawUnsafe(`
        UPDATE "Liquidation"
        SET "status" = 'REVIEWED',
            "reviewedByMembershipId" = 'member-1',
            "reviewedAt" = '2026-05-02T00:00:00.000Z'
        WHERE "id" = 'legacy-v3';
      `);
      await tx.$executeRawUnsafe(`
        UPDATE "Liquidation"
        SET "status" = 'PUBLISHED',
            "publicationSnapshot" = '${JSON.stringify(v3PublicationSnapshot('legacy-v3'))}'::jsonb,
            "publishedByMembershipId" = 'member-1',
            "publishedAt" = '2026-05-03T00:00:00.000Z'
        WHERE "id" = 'legacy-v3';
      `);
      const rows = await tx.$queryRaw<Array<{ status: string; version: number }>>`
        SELECT "status", ("publicationSnapshot" ->> 'version')::int AS version
        FROM "Liquidation" WHERE "id" = 'legacy-v3'
      `;
      expect(rows).toEqual([{ status: 'PUBLISHED', version: 3 }]);
    });
  });

  it('preserves a historical NULL-integrity row when the migration trigger transition is installed', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL search_path = pg_temp, public');
      for (const statement of createSandboxTablesSql) {
        await tx.$executeRawUnsafe(statement);
      }
      await insertReferenceRows(tx);
      // Model a row already present before migration 107's trigger transition.
      await tx.$executeRawUnsafe(`
        INSERT INTO "Liquidation" (
          "id", "tenantId", "buildingId", "period", "chargePeriod", "status",
          "baseCurrency", "totalAmountMinor", "totalsByCurrency", "expenseSnapshot",
          "unitCount", "generatedByMembershipId", "generatedAt", "createdAt", "updatedAt"
        ) VALUES (
          'historical-null', 'tenant-1', 'building-1', '2026-05', '2026-06', 'DRAFT',
          'ARS', 100, '{"ARS":100}'::jsonb, '[]'::jsonb, 2, 'member-1',
          '${timestamp}', '${timestamp}', '${timestamp}'
        );
      `);
      const before = await tx.$queryRaw<Array<Record<string, unknown>>>
        `SELECT * FROM "Liquidation" WHERE "id" = 'historical-null'`;

      await tx.$executeRawUnsafe(distributionValidatorSql);
      await tx.$executeRawUnsafe(compatibilityFunctionSql);
      await tx.$executeRawUnsafe(compatibilityOriginFunctionSql);
      await tx.$executeRawUnsafe(`
        CREATE TRIGGER "Liquidation_publication_integrity"
        BEFORE INSERT OR UPDATE OR DELETE ON "Liquidation"
        FOR EACH ROW EXECUTE FUNCTION enforce_liquidation_publication_integrity();
      `);
      await tx.$executeRawUnsafe(`
        CREATE TRIGGER "Liquidation_publication_integrity_origin"
        BEFORE INSERT OR UPDATE ON "Liquidation"
        FOR EACH ROW EXECUTE FUNCTION enforce_liquidation_publication_integrity_origin();
      `);

      const after = await tx.$queryRaw<Array<Record<string, unknown>>>
        `SELECT * FROM "Liquidation" WHERE "id" = 'historical-null'`;
      expect(after).toEqual(before);
      expect(after[0]?.publicationIntegrityVersion).toBeNull();
    });
  });

  it('allows a modern V1 draft and V4 publication with the validated exact allocation distribution', async () => {
    await withSandbox(async (tx) => {
      await insertLiquidation(tx, 'modern-valid');
      const drafts = await tx.$queryRaw<Array<{
        status: string;
        publicationIntegrityVersion: number;
        distributionSnapshot: { allocations: Allocation[] };
      }>>`
        SELECT "status", "publicationIntegrityVersion", "distributionSnapshot"
        FROM "Liquidation" WHERE "id" = 'modern-valid'
      `;
      expect(drafts[0]?.status).toBe('DRAFT');
      expect(drafts[0]?.publicationIntegrityVersion).toBe(1);
      expect(drafts[0]?.distributionSnapshot.allocations).toEqual(validAllocations);

      await tx.$executeRawUnsafe(`
        UPDATE "Liquidation"
        SET "status" = 'REVIEWED',
            "reviewedByMembershipId" = 'member-1',
            "reviewedAt" = '2026-05-02T00:00:00.000Z'
        WHERE "id" = 'modern-valid';
      `);
      const snapshot = JSON.stringify(v4PublicationSnapshot('modern-valid'));
      await tx.$executeRawUnsafe(`
        UPDATE "Liquidation"
        SET "status" = 'PUBLISHED',
            "publicationSnapshot" = '${snapshot}'::jsonb,
            "publishedByMembershipId" = 'member-1',
            "publishedAt" = '2026-05-03T00:00:00.000Z'
        WHERE "id" = 'modern-valid';
      `);

      const rows = await tx.$queryRaw<Array<{
        status: string;
        publicationSnapshot: { allocations: Allocation[] };
        distributionSnapshot: { allocations: Allocation[] };
      }>>`
        SELECT "status", "publicationSnapshot", "distributionSnapshot"
        FROM "Liquidation" WHERE "id" = 'modern-valid'
      `;
      expect(rows[0]?.status).toBe('PUBLISHED');
      expect(rows[0]?.publicationSnapshot.allocations).toEqual(validAllocations);
      expect(rows[0]?.distributionSnapshot.allocations).toEqual(validAllocations);
    });
  });

  it('rejects a modern distribution whose allocations do not match the calculated split', async () => {
    const invalidAllocations: readonly Allocation[] = [
      { unitId: 'unit-1', unitCode: '1', unitLabel: null, amountMinor: 49 },
      { unitId: 'unit-2', unitCode: '2', unitLabel: 'Suite 2', amountMinor: 51 },
    ];
    await expect(
      withSandbox((tx) => insertLiquidation(tx, 'modern-invalid-distribution', {
        allocations: invalidAllocations,
      })),
    ).rejects.toThrow('modern liquidation publication requires complete frozen distribution evidence');
  });

  const foreignRecipientCases: ReadonlyArray<{
    readonly name: string;
    readonly allocation: Allocation;
  }> = [
    {
      name: 'cross-tenant',
      allocation: { unitId: 'unit-other-tenant', unitCode: 'X', unitLabel: null, amountMinor: totalAmountMinor },
    },
    {
      name: 'cross-building',
      allocation: { unitId: 'unit-other-building', unitCode: 'Y', unitLabel: null, amountMinor: totalAmountMinor },
    },
  ];

  for (const testCase of foreignRecipientCases) {
    it(`rejects a modern ${testCase.name} distribution recipient`, async () => {
      await expect(
        withSandbox((tx) => insertLiquidation(tx, `modern-${testCase.name}`, {
          allocations: [testCase.allocation],
        })),
      ).rejects.toThrow(
        'modern liquidation distribution recipients must belong to the liquidation tenant and building',
      );
    });
  }

  const v4MismatchCases: ReadonlyArray<{
    readonly name: string;
    readonly key: string;
    readonly value: unknown;
  }> = [
    { name: 'liquidation identity', key: 'liquidationId', value: 'different-liquidation' },
    { name: 'tenant identity', key: 'tenantId', value: 'different-tenant' },
    { name: 'building identity', key: 'buildingId', value: 'different-building' },
    { name: 'period metadata', key: 'period', value: '2026-04' },
    { name: 'charge-period metadata', key: 'chargePeriod', value: '2026-07' },
    { name: 'integrity metadata', key: 'publicationIntegrityVersion', value: 2 },
  ];

  for (const testCase of v4MismatchCases) {
    it(`rejects modern V4 ${testCase.name} inconsistent with its liquidation`, async () => {
      await expect(
        withSandbox(async (tx) => {
          await insertLiquidation(tx, 'modern-v4-metadata');
          await tx.$executeRawUnsafe(`
            UPDATE "Liquidation"
            SET "status" = 'REVIEWED',
                "reviewedByMembershipId" = 'member-1',
                "reviewedAt" = '2026-05-02T00:00:00.000Z'
            WHERE "id" = 'modern-v4-metadata';
          `);
          const snapshot = v4PublicationSnapshot('modern-v4-metadata');
          snapshot[testCase.key] = testCase.value;
          await tx.$executeRawUnsafe(`
            UPDATE "Liquidation"
            SET "status" = 'PUBLISHED',
                "publicationSnapshot" = '${JSON.stringify(snapshot)}'::jsonb,
                "publishedByMembershipId" = 'member-1',
                "publishedAt" = '2026-05-03T00:00:00.000Z'
            WHERE "id" = 'modern-v4-metadata';
          `);
        }),
      ).rejects.toThrow();
    });
  }
});
