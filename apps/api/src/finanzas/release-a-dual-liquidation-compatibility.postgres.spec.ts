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

const effectiveDb106PublicationSql = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20260914000000_allow_authorized_parent_cascades/migration.sql',
  ),
  'utf8',
);
const migration105Sql = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20260917000000_harden_phase3d2_nullable_publication_validation/migration.sql',
  ),
  'utf8',
);
const migration104Sql = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20260916000000_harden_phase3d2_distribution_integrity/migration.sql',
  ),
  'utf8',
);
const migration106Sql = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20260918000000_enforce_modern_distribution_unit_ownership/migration.sql',
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

function extractDoBlocks(sql: string): string[] {
  return sql.match(/DO \$\$[\s\S]*?\$\$;/g) ?? [];
}

function extractDollarQuotedConstant(sql: string, name: string, tag: string): string {
  const match = sql.match(
    new RegExp(`${name}\\s+constant\\s+text\\s*:=\\s*\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$;`),
  );
  return match?.[1] ?? '';
}

function replaceExactlyOnce(body: string, expected: string, replacement: string): string {
  const index = body.indexOf(expected);
  if (index < 0 || body.indexOf(expected, index + expected.length) >= 0) {
    throw new Error('Expected function body clause was not found exactly once');
  }
  return `${body.slice(0, index)}${replacement}${body.slice(index + expected.length)}`;
}

const migration107PrimaryBlock = extractDoBlocks(migration107Sql)[0] ?? '';
const migration107OriginBlock = extractDoBlocks(migration107Sql)[1] ?? '';
const db107LegacyClause = extractDollarQuotedConstant(migration107PrimaryBlock, 'old_clause', 'old');
const db107LegacyClauseWithV3 = extractDollarQuotedConstant(migration107PrimaryBlock, 'new_clause', 'new');
const db107NullInsertClause = extractDollarQuotedConstant(migration107OriginBlock, 'old_clause', 'old');

async function executeMigration107(tx: TransactionClient): Promise<void> {
  const statements = extractDoBlocks(migration107Sql);
  if (statements.length !== 2) {
    throw new Error(`Expected two migration 107 rewrite blocks, found ${statements.length}`);
  }
  for (const statement of statements) {
    await tx.$executeRawUnsafe(statement);
  }
}

const distributionValidatorSql = extractFunction(
  migration104Sql,
  'CREATE OR REPLACE FUNCTION validate_liquidation_distribution_snapshot(',
);
const db106PublicationFunctionSql = extractFunction(
  effectiveDb106PublicationSql,
  'CREATE OR REPLACE FUNCTION enforce_liquidation_publication_integrity()',
);
const db106PublicationRewriteSql = extractDoBlocks(migration104Sql)[0] ?? '';
const db106NullablePublicationRewriteSql = extractDoBlocks(migration105Sql)[0] ?? '';
const db106OriginFunctionSql = extractFunction(
  migration106Sql,
  'CREATE OR REPLACE FUNCTION enforce_liquidation_publication_integrity_origin()',
);

async function getPublicationFunctionDefinitions(
  tx: TransactionClient,
): Promise<{ readonly publication: string; readonly origin: string }> {
  const definitions = await tx.$queryRaw<Array<{ readonly name: string; readonly definition: string }>>`
    SELECT p.proname AS name, pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema()
      AND p.proname IN (
        'enforce_liquidation_publication_integrity',
        'enforce_liquidation_publication_integrity_origin'
      )
      AND pg_get_function_identity_arguments(p.oid) = ''
  `;
  const publication = definitions.find(({ name }) => name === 'enforce_liquidation_publication_integrity');
  const origin = definitions.find(({ name }) => name === 'enforce_liquidation_publication_integrity_origin');
  if (!publication || !origin) {
    throw new Error('Could not read both installed publication function definitions');
  }
  return { publication: publication.definition, origin: origin.definition };
}

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
  `CREATE TEMP TABLE "Charge" (
    "id" TEXT PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "chargePeriod" TEXT,
    "type" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "dueDate" TIMESTAMP NOT NULL,
    "liquidationId" TEXT,
    "unitId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL
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

interface V4PublicationSnapshot extends Record<string, unknown> {
  expenses: Array<Record<string, unknown>>;
  allocations: Allocation[];
  totalsByCurrency: Record<string, number>;
}

type TransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

const timestamp = '2026-05-01T00:00:00.000Z';
const totalAmountMinor = 100;
const validExpenseEvidence = [{
  expenseId: 'expense-1',
  categoryName: 'Common expenses',
  vendorName: null,
  amountMinor: totalAmountMinor,
  currencyCode: 'ARS',
  invoiceDate: '2026-05-01',
  description: null,
  type: 'EXPENSE',
}];
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
  distributionTotalAmountMinor = totalAmountMinor,
): Record<string, unknown> {
  return {
    version: 1,
    tenantId: ownerTenantId,
    buildingId: ownerBuildingId,
    totalAmountMinor: distributionTotalAmountMinor,
    movements: [{
      movementId: 'movement-1',
      scope: 'BUILDING',
      unitGroupId: null,
      amountMinor: distributionTotalAmountMinor,
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
): V4PublicationSnapshot {
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
    expenses: validExpenseEvidence.map((expense) => ({ ...expense })),

    incomeOffsets: [],
    allocations: allocations.map((allocation) => ({ ...allocation })),
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
    if (
      !distributionValidatorSql
      || !db106PublicationFunctionSql
      || !db106OriginFunctionSql
      || !db106PublicationRewriteSql
      || !db106NullablePublicationRewriteSql
      || !db107LegacyClause
      || !db107LegacyClauseWithV3
      || !db107NullInsertClause
    ) {
      throw new Error('Could not extract the effective DB106 PostgreSQL functions and rewrites');
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

  async function installDb106Functions(
    tx: TransactionClient,
    applyMigration107: boolean,
  ): Promise<void> {
    await tx.$executeRawUnsafe(distributionValidatorSql);
    await tx.$executeRawUnsafe(db106PublicationFunctionSql);
    await tx.$executeRawUnsafe(db106PublicationRewriteSql);
    await tx.$executeRawUnsafe(db106NullablePublicationRewriteSql);
    await tx.$executeRawUnsafe(db106OriginFunctionSql);
    if (applyMigration107) {
      await executeMigration107(tx);
    }
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
  }

  async function withSandbox<T>(
    action: (tx: TransactionClient) => Promise<T>,
    applyMigration107 = true,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      // Keep installed migration functions and current_schema() aligned in
      // public; PostgreSQL still searches this connection's temp tables first.
      // A passing or failing case rolls back all DDL and fixture rows.
      await tx.$executeRawUnsafe('SET LOCAL search_path = public');
      for (const statement of createSandboxTablesSql) {
        await tx.$executeRawUnsafe(statement);
      }
      await installDb106Functions(tx, applyMigration107);
      await insertReferenceRows(tx);
      return action(tx);
    });
  }

  async function captureRejection(
    tx: TransactionClient,
    phase: string,
    action: () => Promise<void>,
  ): Promise<{ readonly phase: string; readonly error: string | null }> {
    await tx.$executeRawUnsafe('SAVEPOINT expected_rejection');
    try {
      await action();
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT expected_rejection');
      return { phase, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT expected_rejection');
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT expected_rejection');
      return { phase, error: message };
    }
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
      readonly distributionTotalAmountMinor?: number;
      readonly expenseEvidence?: readonly Record<string, unknown>[];
      readonly totalsByCurrency?: Record<string, number>;
    } = {},
  ): Promise<void> {
    const modern = options.modern ?? true;
    const allocations = options.allocations ?? validAllocations;
    const distribution = JSON.stringify(
      distributionSnapshot(
        allocations,
        options.distributionTenantId,
        options.distributionBuildingId,
        options.distributionTotalAmountMinor,
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
        "generatedByMembershipId", "generatedAt", "createdAt", "updatedAt",
        "grossExpenseAmountMinor", "adjustmentAmountMinor", "preIncomeAmountMinor",
        "incomeOffsetAmountMinor", "netDistributableAmountMinor", "incomeOffsetSnapshot",
        "incomeOffsetsByCurrency"
      ) VALUES (
        '${id}', '${tenantId}', '${buildingId}', '2026-05', '2026-06', 'DRAFT',
        ${integrityVersion}, ${valuationMode}, 'ARS', ${totalAmountMinor},
        '${JSON.stringify(options.totalsByCurrency ?? { ARS: totalAmountMinor })}'::jsonb,
        '${JSON.stringify(options.expenseEvidence ?? validExpenseEvidence)}'::jsonb,
        ${distributionValue}, 2, 'member-1', '${timestamp}', '${timestamp}', '${timestamp}',
        ${modern ? totalAmountMinor : 'NULL'}, ${modern ? 0 : 'NULL'},
        ${modern ? totalAmountMinor : 'NULL'}, ${modern ? 0 : 'NULL'},
        ${modern ? totalAmountMinor : 'NULL'}, ${modern ? "'[]'::jsonb" : 'NULL'},
        ${modern ? "'{}'::jsonb" : 'NULL'}
      );
    `);
  }

  async function publishModernLiquidation(
    tx: TransactionClient,
    id: string,
    snapshot: V4PublicationSnapshot = v4PublicationSnapshot(id),
    options: {
      readonly insertCharges?: boolean;
      readonly chargeAllocations?: readonly Allocation[];
    } = {},
  ): Promise<void> {
    await tx.$executeRawUnsafe(`
      UPDATE "Liquidation"
      SET "status" = 'REVIEWED',
          "reviewedByMembershipId" = 'member-1',
          "reviewedAt" = '2026-05-02T00:00:00.000Z'
      WHERE "id" = '${id}';
    `);
    if (options.insertCharges !== false) {
      for (const allocation of (options.chargeAllocations ?? validAllocations)
        .filter(({ amountMinor }) => amountMinor > 0)) {
        await tx.$executeRawUnsafe(`
          INSERT INTO "Charge" (
            "id", "tenantId", "buildingId", "period", "chargePeriod", "type",
            "concept", "currency", "dueDate", "liquidationId", "unitId", "amount"
          ) VALUES (
            'charge-${id}-${allocation.unitId}', '${tenantId}', '${buildingId}',
            '2026-05', '2026-06', 'COMMON_EXPENSE', 'Expensas comunes 2026-05',
            'ARS', '2026-06-10 00:00:00', '${id}', '${allocation.unitId}',
            ${allocation.amountMinor}
          );
        `);
      }
    }
    await tx.$executeRawUnsafe(`
      UPDATE "Liquidation"
      SET "status" = 'PUBLISHED',
          "publicationSnapshot" = '${JSON.stringify(snapshot)}'::jsonb,
          "publishedByMembershipId" = 'member-1',
          "publishedAt" = '2026-05-03T00:00:00.000Z'
      WHERE "id" = '${id}';
    `);
  }

  it('allows db82d3 legacy NULL-integrity drafts and pinned V3 publication through DB107', async () => {
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

  it.each([
    ['effective DB106', false, 'new liquidations require publication integrity v1'],
    ['exact DB107 rewrite', true, null],
  ] as const)('characterizes a new legacy NULL-integrity draft under %s', async (generation, applyMigration107, expectedError) => {
    const result = await withSandbox(
      (tx) => captureRejection(tx, 'draft INSERT', () => insertLiquidation(tx, `new-null-${generation}`, { modern: false })),
      applyMigration107,
    );
    expect(result.phase).toBe('draft INSERT');
    if (expectedError) {
      expect(result.error).toContain(expectedError);
    } else {
      expect(result.error).toBeNull();
    }
  });

  it.each([
    ['effective DB106', false, 'legacy liquidation drafts cannot be published'],
    ['exact DB107 rewrite', true, null],
  ] as const)('characterizes legacy V3 publication under %s', async (generation, applyMigration107, expectedError) => {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL search_path = public');
      for (const statement of createSandboxTablesSql) {
        await tx.$executeRawUnsafe(statement);
      }
      await insertReferenceRows(tx);
      // Seed a historical legacy draft before installing triggers; the tested
      // rejection/acceptance is the real DB106/107 publication transition.
      await insertLiquidation(tx, `legacy-v3-control-${generation}`, { modern: false });
      await installDb106Functions(tx, applyMigration107);
      await tx.$executeRawUnsafe(`
        UPDATE "Liquidation"
        SET "status" = 'REVIEWED',
            "reviewedByMembershipId" = 'member-1',
            "reviewedAt" = '2026-05-02T00:00:00.000Z'
        WHERE "id" = 'legacy-v3-control-${generation}';
      `);
      const id = `legacy-v3-control-${generation}`;
      const rejection = await captureRejection(tx, 'publication transition', async () => {
        await tx.$executeRawUnsafe(`
          UPDATE "Liquidation"
          SET "status" = 'PUBLISHED',
              "publicationSnapshot" = '${JSON.stringify(v3PublicationSnapshot(id))}'::jsonb,
              "publishedByMembershipId" = 'member-1',
              "publishedAt" = '2026-05-03T00:00:00.000Z'
          WHERE "id" = '${id}';
        `);
      });
      return rejection;
    });
    expect(result.phase).toBe('publication transition');
    if (expectedError) {
      expect(result.error).toContain(expectedError);
    } else {
      expect(result.error).toBeNull();
    }
  });

  it('preserves a historical NULL-integrity row when the migration trigger transition is installed', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL search_path = public');
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

      await installDb106Functions(tx, true);

      const after = await tx.$queryRaw<Array<Record<string, unknown>>>
        `SELECT * FROM "Liquidation" WHERE "id" = 'historical-null'`;
      expect(after).toEqual(before);
      expect(after[0]?.publicationIntegrityVersion).toBeNull();
    });
  });

  it('changes each installed function by exactly its single DB107 clause replacement', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL search_path = public');
      for (const statement of createSandboxTablesSql) {
        await tx.$executeRawUnsafe(statement);
      }
      await installDb106Functions(tx, false);
      const before = await getPublicationFunctionDefinitions(tx);
      const expectedPublication = replaceExactlyOnce(
        before.publication,
        db107LegacyClause,
        db107LegacyClauseWithV3,
      );
      const expectedOrigin = replaceExactlyOnce(before.origin, db107NullInsertClause, '');

      await executeMigration107(tx);
      const after = await getPublicationFunctionDefinitions(tx);
      expect(after.publication).toBe(expectedPublication);
      expect(after.origin).toBe(expectedOrigin);
    });
  });

  it.each([
    ['effective DB106', false],
    ['exact DB107 rewrite', true],
  ] as const)('publishes a coherent V4 fixture under %s', async (generation, applyMigration107) => {
    await withSandbox(async (tx) => {
      await insertLiquidation(tx, `modern-valid-${generation}`);
      await publishModernLiquidation(tx, `modern-valid-${generation}`);
      const rows = await tx.$queryRaw<Array<{
        status: string;
        publicationSnapshot: { allocations: Allocation[]; expenses: unknown[] };
        distributionSnapshot: { allocations: Allocation[] };
      }>>`
        SELECT "status", "publicationSnapshot", "distributionSnapshot"
        FROM "Liquidation" WHERE "id" = ${`modern-valid-${generation}`}
      `;
      expect(rows[0]?.status).toBe('PUBLISHED');
      expect(rows[0]?.publicationSnapshot.allocations).toEqual(validAllocations);
      expect(rows[0]?.publicationSnapshot.expenses).toEqual(validExpenseEvidence);
      expect(rows[0]?.distributionSnapshot.allocations).toEqual(validAllocations);
    }, applyMigration107);
  });

  it.each([
    ['effective DB106', false],
    ['exact DB107 rewrite', true],
  ] as const)('rejects V4 publication when distribution aggregates total 99 against liquidation total 100 under %s', async (generation, applyMigration107) => {
    const invalidDistributionAllocations: readonly Allocation[] = [
      { unitId: 'unit-1', unitCode: '1', unitLabel: null, amountMinor: 49 },
      { unitId: 'unit-2', unitCode: '2', unitLabel: 'Suite 2', amountMinor: 50 },
    ];
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL search_path = public');
      for (const statement of createSandboxTablesSql) {
        await tx.$executeRawUnsafe(statement);
      }
      await insertReferenceRows(tx);
      // Seed the aggregate disagreement before trigger installation so the
      // publication attempt exercises the DB106/107 validators themselves.
      const id = `distribution-total-mismatch-${generation}`;
      await insertLiquidation(tx, id, {
        allocations: invalidDistributionAllocations,
        distributionTotalAmountMinor: 99,
      });
      await installDb106Functions(tx, applyMigration107);
      const snapshot = v4PublicationSnapshot(id, invalidDistributionAllocations);
      return captureRejection(tx, 'review transition during publication attempt', () => publishModernLiquidation(
        tx,
        id,
        snapshot,
        { chargeAllocations: invalidDistributionAllocations },
      ));
    });
    expect(result.phase).toBe('review transition during publication attempt');
    expect(result.error).toContain('modern liquidation publication requires complete frozen distribution evidence');
  });

  it.each([
    ['effective DB106', false],
    ['exact DB107 rewrite', true],
  ] as const)('rejects V4 publication when expense currency totals do not reconcile under %s', async (generation, applyMigration107) => {
    const mixedCurrencyExpenses = [
      { ...validExpenseEvidence[0], amountMinor: 40, currencyCode: 'ARS' },
      { ...validExpenseEvidence[0], expenseId: 'expense-2', amountMinor: 60, currencyCode: 'USD' },
    ];
    await withSandbox(async (tx) => {
      const id = `currency-total-mismatch-${generation}`;
      await insertLiquidation(tx, id, { expenseEvidence: mixedCurrencyExpenses });
      const snapshot = v4PublicationSnapshot(id);
      snapshot.expenses = mixedCurrencyExpenses.map((expense) => ({ ...expense }));
      expect(snapshot.totalAmountMinor).toBe(totalAmountMinor);
      expect(snapshot.totalsByCurrency).toEqual({ ARS: totalAmountMinor });
      expect(snapshot.expenses.map(({ currencyCode, amountMinor }) => [currencyCode, amountMinor])).toEqual([
        ['ARS', 40],
        ['USD', 60],
      ]);
      const [draft] = await tx.$queryRaw<Array<{
        totalAmountMinor: bigint;
        totalsByCurrency: Record<string, number>;
        expenseSnapshot: Array<{ currencyCode: string; amountMinor: number }>;
      }>>`
        SELECT "totalAmountMinor", "totalsByCurrency", "expenseSnapshot"
        FROM "Liquidation" WHERE "id" = ${id}
      `;
      expect(draft?.totalAmountMinor).toBe(BigInt(totalAmountMinor));
      expect(draft?.totalsByCurrency).toEqual({ ARS: totalAmountMinor });
      expect(draft?.expenseSnapshot.map(({ currencyCode, amountMinor }) => [currencyCode, amountMinor])).toEqual([
        ['ARS', 40],
        ['USD', 60],
      ]);
      const result = await captureRejection(tx, 'publication transition', () => publishModernLiquidation(tx, id, snapshot));
      expect(result.phase).toBe('publication transition');
      expect(result.error).toContain('modern liquidation publication requires complete matching V4 evidence');
    }, applyMigration107);
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
    it.each([
      ['effective DB106', false],
      ['exact DB107 rewrite', true],
    ] as const)(`rejects a modern ${testCase.name} distribution recipient under %s`, async (_generation, applyMigration107) => {
      await expect(
        withSandbox((tx) => insertLiquidation(tx, `modern-${testCase.name}`, {
          allocations: [testCase.allocation],
        }), applyMigration107),
      ).rejects.toThrow(
        'modern liquidation distribution recipients must belong to the liquidation tenant and building',
      );
    });
  }

  const v4EvidenceFailureCases: ReadonlyArray<{
    readonly name: string;
    readonly mutate: (snapshot: V4PublicationSnapshot) => void;
    readonly insertCharges?: boolean;
    readonly chargeAllocations?: readonly Allocation[];
  }> = [
    {
      name: 'snapshot total differs from liquidation total',
      mutate: (snapshot) => { snapshot.totalAmountMinor = 99; },
    },
    {
      name: 'publication expenses differ from frozen expense evidence',
      mutate: (snapshot) => { snapshot.expenses[0] = { ...snapshot.expenses[0], amountMinor: 99 }; },
    },
    {
      name: 'allocation total differs from liquidation total',
      mutate: (snapshot) => {
        snapshot.allocations[0] = { ...snapshot.allocations[0], amountMinor: 49 };
      },
    },
    {
      name: 'per-unit allocation differs from distribution evidence',
      mutate: (snapshot) => {
        snapshot.allocations = [
          { ...snapshot.allocations[0], amountMinor: 49 },
          { ...snapshot.allocations[1], amountMinor: 51 },
        ];
      },
    },
    {
      name: 'generated charges are missing',
      mutate: () => undefined,
      insertCharges: false,
    },
    {
      name: 'generated charge amounts are tampered',
      mutate: () => undefined,
      chargeAllocations: [
        { ...validAllocations[0], amountMinor: 49 },
        { ...validAllocations[1], amountMinor: 51 },
      ],
    },
    {
      name: 'publication recipient is switched to another tenant',
      mutate: (snapshot) => {
        snapshot.allocations[0] = { ...snapshot.allocations[0], unitId: 'unit-other-tenant', unitCode: 'X' };
      },
      chargeAllocations: [
        { ...validAllocations[0], unitId: 'unit-other-tenant', unitCode: 'X' },
        validAllocations[1],
      ],
    },
    {
      name: 'publication recipient is switched to another building',
      mutate: (snapshot) => {
        snapshot.allocations[0] = { ...snapshot.allocations[0], unitId: 'unit-other-building', unitCode: 'Y' };
      },
      chargeAllocations: [
        { ...validAllocations[0], unitId: 'unit-other-building', unitCode: 'Y' },
        validAllocations[1],
      ],
    },
    {
      name: 'missing required expense evidence',
      mutate: (snapshot) => { Reflect.deleteProperty(snapshot, 'expenses'); },
    },
    {
      name: 'empty required expense evidence',
      mutate: (snapshot) => { snapshot.expenses = []; },
    },
    {
      name: 'missing required allocation evidence',
      mutate: (snapshot) => { Reflect.deleteProperty(snapshot, 'allocations'); },
    },
    {
      name: 'empty required allocation evidence',
      mutate: (snapshot) => { snapshot.allocations = []; },
    },
    {
      name: 'missing required due date evidence',
      mutate: (snapshot) => { Reflect.deleteProperty(snapshot, 'dueDate'); },
    },
    {
      name: 'empty required due date evidence',
      mutate: (snapshot) => { snapshot.dueDate = ''; },
    },
    {
      name: 'missing required publication timestamp',
      mutate: (snapshot) => { Reflect.deleteProperty(snapshot, 'publishedAt'); },
    },
    {
      name: 'tampered recipient identity',
      mutate: (snapshot) => {
        snapshot.allocations[0] = { ...snapshot.allocations[0], unitCode: 'spoofed' };
      },
    },
  ];

  for (const testCase of v4EvidenceFailureCases) {
    it.each([
      ['effective DB106', false],
      ['exact DB107 rewrite', true],
    ] as const)(`rejects V4 publication when ${testCase.name} under %s`, async (generation, applyMigration107) => {
      await withSandbox(async (tx) => {
        const id = `modern-invalid-${generation.replaceAll(' ', '-')}-${testCase.name.replaceAll(' ', '-')}`;
        await insertLiquidation(tx, id);
        const snapshot = v4PublicationSnapshot(id);
        testCase.mutate(snapshot);
        await expect(publishModernLiquidation(tx, id, snapshot, {
          insertCharges: testCase.insertCharges,
          chargeAllocations: testCase.chargeAllocations,
        })).rejects.toThrow(
          'modern liquidation publication requires complete matching V4 evidence',
        );
      }, applyMigration107);
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
    { name: 'valuation metadata', key: 'valuationMode', value: 'FUNCTIONAL' },
    { name: 'currency metadata', key: 'baseCurrency', value: 'USD' },
    { name: 'currency totals metadata', key: 'totalsByCurrency', value: { USD: 100 } },
  ];

  for (const testCase of v4MismatchCases) {
    it.each([
      ['effective DB106', false],
      ['exact DB107 rewrite', true],
    ] as const)(`rejects modern V4 ${testCase.name} under %s`, async (generation, applyMigration107) => {
      await withSandbox(async (tx) => {
        const id = `modern-v4-metadata-${generation.replaceAll(' ', '-')}`;
        await insertLiquidation(tx, id);
        const snapshot = v4PublicationSnapshot(id);
        snapshot[testCase.key] = testCase.value;
        await expect(publishModernLiquidation(tx, id, snapshot)).rejects.toThrow(
          'modern liquidation publication requires complete matching V4 evidence',
        );
      }, applyMigration107);
    });
  }
});
