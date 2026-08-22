import {
  IncomeStatus,
  LiquidationStatus,
  MovementScope,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import {
  FIN07D_HISTORICAL_V1_PERIOD,
  FIN07D_HISTORICAL_V2_PERIOD,
  FIN07D_NORMAL_V3_PERIOD,
  FIN07D_RESERVE_FUND_NAME,
  FIN07D_SPECIAL_FUND_NAME,
  FIN07D_ZERO_NET_PERIOD,
  LEGACY_BACKFIX_ALREADY_PLAN_ID,
  LEGACY_BACKFIX_AUTO_OFFSET_ID,
  LEGACY_BACKFIX_CONFLICT_ID,
  LEGACY_BACKFIX_RESERVE_FUND_ID,
  LEGACY_BACKFIX_SPECIAL_FUND_ID,
  ensureSeedFinanceFixture,
} from './seed-finance-fixture';
import {
  readFin07dMutableLiquidations,
  unregisterFin07dMutableLiquidations,
} from './fin07d-e2e-liquidation-registry';

const RESET_OPT_IN = 'FIN07D_E2E_RESET';
const ALLOWED_NODE_ENVS = new Set(['development', 'test']);
const ALLOWED_URL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const ALLOWED_SERVER_ADDRESSES = new Set(['127.0.0.1', '::1']);
const ALLOWED_DATABASE_TARGETS = [
  { database: 'buildingos', urlPort: 5434, serverPort: 5432 },
  { database: 'buildingos_test', urlPort: 5432, serverPort: 5432 },
] as const;

const TENANT_A_NAME = 'Test Tenant A';
const TENANT_B_NAME = 'Test Tenant B';
const BUILDING_A1_NAME = 'Torre A Test';
const BUILDING_A2_NAME = 'Torre B Test';
const ADMIN_A_EMAIL = 'test-tenant-admin-a@buildingos.local';
const POLICY_CATEGORY_CODE = 'FIN07D_POLICY_INCOME';
const NORMAL_EXPENSE_DESCRIPTION = '[FIN07D:NORMAL_V3] Expense A1 6000';
const NORMAL_BUILDING_INCOME_DESCRIPTION = '[FIN07D:NORMAL_V3] Income BUILDING A1 1500';
const NORMAL_SHARED_INCOME_DESCRIPTION = '[FIN07D:NORMAL_V3] Income TENANT_SHARED 7000';
const ZERO_NET_EXPENSE_DESCRIPTION = '[FIN07D:ZERO_NET] Expense A1 5000';
const ZERO_NET_INCOME_DESCRIPTION = '[FIN07D:ZERO_NET] Income BUILDING A1 5000';

export const FIN07D_MUTABLE_MARKER = '[FIN07D:E2E:MUTABLE]';

interface ResetEnvironment {
  readonly [key: string]: string | undefined;
  readonly NODE_ENV?: string;
  readonly DATABASE_URL?: string;
  readonly FIN07D_E2E_RESET?: string;
}

interface ConnectedDatabase {
  readonly database: string;
  readonly address: string | null;
  readonly port: number | null;
}

interface BaselineInput {
  readonly tenantAId: string;
  readonly tenantBId: string;
  readonly buildingA1Id: string;
  readonly buildingA2Id: string;
  readonly adminMembershipId: string;
  readonly adminRoles: string[];
}

export interface Fin07dFixtureContext {
  readonly tenantAId: string;
  readonly tenantBId: string;
  readonly buildingA1Id: string;
  readonly buildingA2Id: string;
  readonly adminMembershipId: string;
  readonly reserveFundId: string;
  readonly specialFundId: string;
  readonly policyId: string;
  readonly policyVersionId: string;
  readonly normalV3ExpenseId: string;
  readonly normalV3BuildingIncomeId: string;
  readonly normalV3SharedIncomeId: string;
  readonly normalV3BuildingApplicationId: string;
  readonly normalV3SharedApplicationId: string;
  readonly zeroNetExpenseId: string;
  readonly zeroNetIncomeId: string;
  readonly zeroNetApplicationId: string;
  readonly historicalV1LiquidationId: string;
  readonly historicalV2LiquidationId: string;
  readonly autoMappableOffsetIncomeId: string;
  readonly requiresReserveFundIncomeId: string;
  readonly requiresSpecialFundIncomeId: string;
  readonly alreadyHasPlanIncomeId: string;
  readonly liquidationConflictIncomeId: string;
}

function requiredEnvironmentValue(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`FIN07D reset requires ${name}`);
  }
  return normalized;
}

function isAllowedUrlTarget(database: string, port: number): boolean {
  return ALLOWED_DATABASE_TARGETS.some(
    (target) => target.database === database && target.urlPort === port,
  );
}

function isAllowedConnectedTarget(database: string, port: number): boolean {
  return ALLOWED_DATABASE_TARGETS.some(
    (target) => target.database === database && target.serverPort === port,
  );
}

export function assertSafeFin07dResetEnvironment(environment: ResetEnvironment): URL {
  if (environment[RESET_OPT_IN] !== '1') {
    throw new Error(`FIN07D reset requires ${RESET_OPT_IN}=1`);
  }

  const nodeEnv = requiredEnvironmentValue(environment.NODE_ENV, 'NODE_ENV').toLowerCase();
  if (!ALLOWED_NODE_ENVS.has(nodeEnv)) {
    throw new Error(`FIN07D reset refuses NODE_ENV=${nodeEnv}`);
  }

  const databaseUrl = new URL(requiredEnvironmentValue(environment.DATABASE_URL, 'DATABASE_URL'));
  const database = databaseUrl.pathname.replace(/^\//, '');
  const port = Number(databaseUrl.port || '5432');

  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('FIN07D reset requires PostgreSQL');
  }
  if (!ALLOWED_URL_HOSTS.has(databaseUrl.hostname.toLowerCase())) {
    throw new Error('FIN07D reset refuses a non-local database host');
  }
  if (!isAllowedUrlTarget(database, port)) {
    throw new Error('FIN07D reset refuses an unknown database target');
  }

  return databaseUrl;
}

async function assertConnectedDatabase(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<ConnectedDatabase[]>(Prisma.sql`
    SELECT
      current_database() AS "database",
      inet_server_addr()::text AS "address",
      inet_server_port() AS "port"
  `);
  const connection = rows[0];

  if (!connection) {
    throw new Error('FIN07D reset could not inspect the active database connection');
  }
  if (
    connection.port === null ||
    !isAllowedConnectedTarget(connection.database, connection.port)
  ) {
    throw new Error('FIN07D reset connected to an unexpected database');
  }
  const address = connection.address?.toLowerCase() ?? '';
  const isPrivateContainerAddress =
    /^10\./.test(address) ||
    /^192\.168\./.test(address) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address);
  if (!address || (!ALLOWED_SERVER_ADDRESSES.has(address) && !isPrivateContainerAddress)) {
    throw new Error('FIN07D reset connected through a non-local address');
  }
}

async function resolveBaselineInput(prisma: PrismaClient): Promise<BaselineInput> {
  const [tenantA, tenantB] = await Promise.all([
    prisma.tenant.findUnique({ where: { name: TENANT_A_NAME }, select: { id: true } }),
    prisma.tenant.findUnique({ where: { name: TENANT_B_NAME }, select: { id: true } }),
  ]);
  if (!tenantA || !tenantB) {
    throw new Error('FIN07D reset requires deterministic Tenant A and Tenant B');
  }

  const [buildingA1, buildingA2, adminUser] = await Promise.all([
    prisma.building.findUnique({
      where: { tenantId_name: { tenantId: tenantA.id, name: BUILDING_A1_NAME } },
      select: { id: true },
    }),
    prisma.building.findUnique({
      where: { tenantId_name: { tenantId: tenantA.id, name: BUILDING_A2_NAME } },
      select: { id: true },
    }),
    prisma.user.findUnique({ where: { email: ADMIN_A_EMAIL }, select: { id: true } }),
  ]);
  if (!buildingA1 || !buildingA2 || !adminUser) {
    throw new Error('FIN07D reset requires deterministic buildings and admin');
  }

  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: adminUser.id, tenantId: tenantA.id } },
    include: { roles: { select: { role: true } } },
  });
  if (!membership) {
    throw new Error('FIN07D reset requires the Tenant A admin membership');
  }

  return {
    tenantAId: tenantA.id,
    tenantBId: tenantB.id,
    buildingA1Id: buildingA1.id,
    buildingA2Id: buildingA2.id,
    adminMembershipId: membership.id,
    adminRoles: membership.roles.map((role) => role.role),
  };
}

async function findExactlyOne(
  label: string,
  records: readonly { id: string }[],
): Promise<string> {
  if (records.length !== 1) {
    throw new Error(`FIN07D fixture expected one ${label}; found ${records.length}`);
  }
  return records[0]!.id;
}

export async function resolveFin07dFixtureContext(
  prisma: PrismaClient,
): Promise<Fin07dFixtureContext> {
  const baseline = await resolveBaselineInput(prisma);
  const [funds, policyCategory, normalExpenses, normalBuildingIncomes, normalSharedIncomes,
    zeroNetExpenses, zeroNetIncomes, historicalV1, historicalV2] = await Promise.all([
    prisma.fund.findMany({
      where: {
        tenantId: baseline.tenantAId,
        name: { in: [FIN07D_RESERVE_FUND_NAME, FIN07D_SPECIAL_FUND_NAME] },
        buildingId: null,
        status: 'ACTIVE',
      },
      select: { id: true, name: true },
    }),
    prisma.expenseLedgerCategory.findUnique({
      where: { tenantId_code: { tenantId: baseline.tenantAId, code: POLICY_CATEGORY_CODE } },
      select: { id: true },
    }),
    prisma.expense.findMany({
      where: { tenantId: baseline.tenantAId, buildingId: baseline.buildingA1Id, period: FIN07D_NORMAL_V3_PERIOD, description: NORMAL_EXPENSE_DESCRIPTION },
      select: { id: true },
    }),
    prisma.income.findMany({
      where: { tenantId: baseline.tenantAId, buildingId: baseline.buildingA1Id, period: FIN07D_NORMAL_V3_PERIOD, description: NORMAL_BUILDING_INCOME_DESCRIPTION },
      select: { id: true },
    }),
    prisma.income.findMany({
      where: { tenantId: baseline.tenantAId, buildingId: null, period: FIN07D_NORMAL_V3_PERIOD, description: NORMAL_SHARED_INCOME_DESCRIPTION },
      select: { id: true },
    }),
    prisma.expense.findMany({
      where: { tenantId: baseline.tenantAId, buildingId: baseline.buildingA1Id, period: FIN07D_ZERO_NET_PERIOD, description: ZERO_NET_EXPENSE_DESCRIPTION },
      select: { id: true },
    }),
    prisma.income.findMany({
      where: { tenantId: baseline.tenantAId, buildingId: baseline.buildingA1Id, period: FIN07D_ZERO_NET_PERIOD, description: ZERO_NET_INCOME_DESCRIPTION },
      select: { id: true },
    }),
    prisma.liquidation.findMany({
      where: { tenantId: baseline.tenantAId, buildingId: baseline.buildingA1Id, period: FIN07D_HISTORICAL_V1_PERIOD, status: LiquidationStatus.PUBLISHED },
      select: { id: true },
    }),
    prisma.liquidation.findMany({
      where: { tenantId: baseline.tenantAId, buildingId: baseline.buildingA1Id, period: FIN07D_HISTORICAL_V2_PERIOD, status: LiquidationStatus.PUBLISHED },
      select: { id: true },
    }),
  ]);

  const reserveFund = funds.filter((fund) => fund.name === FIN07D_RESERVE_FUND_NAME);
  const specialFund = funds.filter((fund) => fund.name === FIN07D_SPECIAL_FUND_NAME);
  if (!policyCategory) {
    throw new Error('FIN07D fixture policy category is missing');
  }

  const policy = await prisma.incomePolicy.findUnique({
    where: { tenantId_categoryId: { tenantId: baseline.tenantAId, categoryId: policyCategory.id } },
    include: { versions: { where: { status: 'ACTIVE' }, select: { id: true } } },
  });
  if (!policy || policy.versions.length !== 1) {
    throw new Error('FIN07D fixture requires exactly one active policy version');
  }

  const normalBuildingIncomeId = await findExactlyOne('NORMAL_V3 building income', normalBuildingIncomes);
  const normalSharedIncomeId = await findExactlyOne('NORMAL_V3 shared income', normalSharedIncomes);
  const zeroNetIncomeId = await findExactlyOne('ZERO_NET income', zeroNetIncomes);
  const [normalBuildingApplications, normalSharedApplications, zeroNetApplications] = await Promise.all([
    prisma.incomeApplication.findMany({
      where: { tenantId: baseline.tenantAId, incomeId: normalBuildingIncomeId, destinationType: 'OFFSET_EXPENSES' },
      select: { id: true },
    }),
    prisma.incomeApplication.findMany({
      where: { tenantId: baseline.tenantAId, incomeId: normalSharedIncomeId, destinationType: 'OFFSET_EXPENSES' },
      select: { id: true },
    }),
    prisma.incomeApplication.findMany({
      where: { tenantId: baseline.tenantAId, incomeId: zeroNetIncomeId, destinationType: 'OFFSET_EXPENSES' },
      select: { id: true },
    }),
  ]);

  const legacy = await prisma.income.findMany({
    where: {
      tenantId: baseline.tenantAId,
      id: {
        in: [
          LEGACY_BACKFIX_AUTO_OFFSET_ID,
          LEGACY_BACKFIX_RESERVE_FUND_ID,
          LEGACY_BACKFIX_SPECIAL_FUND_ID,
          LEGACY_BACKFIX_ALREADY_PLAN_ID,
          LEGACY_BACKFIX_CONFLICT_ID,
        ],
      },
    },
    select: { id: true },
  });
  const legacyIds = new Set(legacy.map((income) => income.id));
  for (const expectedId of [LEGACY_BACKFIX_AUTO_OFFSET_ID, LEGACY_BACKFIX_RESERVE_FUND_ID,
    LEGACY_BACKFIX_SPECIAL_FUND_ID, LEGACY_BACKFIX_ALREADY_PLAN_ID, LEGACY_BACKFIX_CONFLICT_ID]) {
    if (!legacyIds.has(expectedId)) {
      throw new Error(`FIN07D fixture legacy income is missing: ${expectedId}`);
    }
  }

  return {
    tenantAId: baseline.tenantAId,
    tenantBId: baseline.tenantBId,
    buildingA1Id: baseline.buildingA1Id,
    buildingA2Id: baseline.buildingA2Id,
    adminMembershipId: baseline.adminMembershipId,
    reserveFundId: await findExactlyOne('reserve fund', reserveFund),
    specialFundId: await findExactlyOne('special fund', specialFund),
    policyId: policy.id,
    policyVersionId: policy.versions[0]!.id,
    normalV3ExpenseId: await findExactlyOne('NORMAL_V3 expense', normalExpenses),
    normalV3BuildingIncomeId: normalBuildingIncomeId,
    normalV3SharedIncomeId: normalSharedIncomeId,
    normalV3BuildingApplicationId: await findExactlyOne('NORMAL_V3 building application', normalBuildingApplications),
    normalV3SharedApplicationId: await findExactlyOne('NORMAL_V3 shared application', normalSharedApplications),
    zeroNetExpenseId: await findExactlyOne('ZERO_NET expense', zeroNetExpenses),
    zeroNetIncomeId,
    zeroNetApplicationId: await findExactlyOne('ZERO_NET application', zeroNetApplications),
    historicalV1LiquidationId: await findExactlyOne('historical V1 liquidation', historicalV1),
    historicalV2LiquidationId: await findExactlyOne('historical V2 liquidation', historicalV2),
    autoMappableOffsetIncomeId: LEGACY_BACKFIX_AUTO_OFFSET_ID,
    requiresReserveFundIncomeId: LEGACY_BACKFIX_RESERVE_FUND_ID,
    requiresSpecialFundIncomeId: LEGACY_BACKFIX_SPECIAL_FUND_ID,
    alreadyHasPlanIncomeId: LEGACY_BACKFIX_ALREADY_PLAN_ID,
    liquidationConflictIncomeId: LEGACY_BACKFIX_CONFLICT_ID,
  };
}

export async function createFin07dDisposableMarker(
  prisma: PrismaClient,
): Promise<string> {
  assertSafeFin07dResetEnvironment(process.env);
  await assertConnectedDatabase(prisma);
  const baseline = await resolveBaselineInput(prisma);
  const category = await prisma.expenseLedgerCategory.findUnique({
    where: { tenantId_code: { tenantId: baseline.tenantAId, code: 'FIN07D_INCOME_COMMON' } },
    select: { id: true },
  });
  if (!category) {
    throw new Error('FIN07D disposable marker requires the fixture income category');
  }

  const marker = await prisma.income.create({
    data: {
      tenantId: baseline.tenantAId,
      buildingId: baseline.buildingA1Id,
      period: FIN07D_NORMAL_V3_PERIOD,
      categoryId: category.id,
      scopeType: MovementScope.BUILDING,
      amountMinor: 1,
      currencyCode: 'ARS',
      receivedDate: new Date('2026-06-30T00:00:00.000Z'),
      description: `${FIN07D_MUTABLE_MARKER} reset proof`,
      status: IncomeStatus.DRAFT,
      createdByMembershipId: baseline.adminMembershipId,
    },
    select: { id: true },
  });
  return marker.id;
}

export async function resetFin07dMutableState(
  prisma: PrismaClient,
): Promise<Fin07dFixtureContext> {
  const databaseUrl = assertSafeFin07dResetEnvironment(process.env).toString();
  await assertConnectedDatabase(prisma);
  const baseline = await resolveBaselineInput(prisma);
  const registeredLiquidationIds = await readFin07dMutableLiquidations(databaseUrl);

  await prisma.$transaction(async (tx) => {
    const registeredLiquidations = registeredLiquidationIds.length > 0
      ? await tx.liquidation.findMany({
        where: { id: { in: registeredLiquidationIds } },
        select: { id: true, tenantId: true, buildingId: true, period: true, status: true },
      })
      : [];
    const allowedPeriods = new Set([FIN07D_NORMAL_V3_PERIOD, FIN07D_ZERO_NET_PERIOD]);
    const allowedStatuses = new Set<LiquidationStatus>([
      LiquidationStatus.DRAFT,
      LiquidationStatus.REVIEWED,
    ]);
    for (const liquidation of registeredLiquidations) {
      if (liquidation.tenantId !== baseline.tenantAId) {
        throw new Error(`FIN07D reset refuses registered liquidation ${liquidation.id} from another tenant`);
      }
      if (liquidation.buildingId !== baseline.buildingA1Id) {
        throw new Error(`FIN07D reset refuses registered liquidation ${liquidation.id} from another building`);
      }
      if (!allowedPeriods.has(liquidation.period)) {
        throw new Error(`FIN07D reset refuses registered liquidation ${liquidation.id} from period ${liquidation.period}`);
      }
      if (!allowedStatuses.has(liquidation.status)) {
        throw new Error(`FIN07D reset refuses registered liquidation ${liquidation.id} with status ${liquidation.status}`);
      }
    }

    const foundLiquidationIds = registeredLiquidations.map((liquidation) => liquidation.id);
    if (foundLiquidationIds.length > 0) {
      const chargeCount = await tx.charge.count({ where: { liquidationId: { in: foundLiquidationIds } } });
      if (chargeCount > 0) {
        throw new Error('FIN07D reset refuses registered liquidations with charges');
      }
      await tx.liquidation.deleteMany({ where: { id: { in: foundLiquidationIds } } });
    }

    const disposableIncomes = await tx.income.findMany({
      where: { tenantId: baseline.tenantAId, description: { startsWith: FIN07D_MUTABLE_MARKER } },
      select: { id: true },
    });
    const disposableIncomeIds = disposableIncomes.map((income) => income.id);
    const resettableLegacyIncomeIds = [
      LEGACY_BACKFIX_AUTO_OFFSET_ID,
      LEGACY_BACKFIX_RESERVE_FUND_ID,
      LEGACY_BACKFIX_SPECIAL_FUND_ID,
      LEGACY_BACKFIX_CONFLICT_ID,
    ];
    const applications = await tx.incomeApplication.findMany({
      where: {
        tenantId: baseline.tenantAId,
        incomeId: { in: [...disposableIncomeIds, ...resettableLegacyIncomeIds] },
      },
      select: { id: true },
    });
    const applicationIds = applications.map((application) => application.id);

    if (applicationIds.length > 0) {
      const remainingOffsetCount = await tx.liquidationIncomeOffset.count({
        where: { incomeApplicationId: { in: applicationIds } },
      });
      if (remainingOffsetCount > 0) {
        throw new Error('FIN07D reset refuses applications referenced by retained liquidations');
      }
    }

    const managedTransactions = applicationIds.length > 0
      ? await tx.fundTransaction.findMany({
        where: { tenantId: baseline.tenantAId, incomeApplicationId: { in: applicationIds } },
        select: { id: true },
      })
      : [];
    const taggedTransactions = await tx.fundTransaction.findMany({
      where: {
        tenantId: baseline.tenantAId,
        OR: [
          { description: { startsWith: FIN07D_MUTABLE_MARKER } },
          { idempotencyKey: { startsWith: FIN07D_MUTABLE_MARKER } },
        ],
      },
      select: { id: true },
    });
    const transactionIds = [...new Set([...managedTransactions, ...taggedTransactions].map((transaction) => transaction.id))];
    if (transactionIds.length > 0) {
      await tx.fundTransaction.deleteMany({ where: { reversalOfTransactionId: { in: transactionIds } } });
      await tx.fundTransaction.deleteMany({ where: { id: { in: transactionIds } } });
    }
    if (applicationIds.length > 0) {
      await tx.incomeApplication.deleteMany({ where: { id: { in: applicationIds } } });
    }
    if (disposableIncomeIds.length > 0) {
      await tx.income.deleteMany({ where: { id: { in: disposableIncomeIds } } });
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await ensureSeedFinanceFixture({
    prisma,
    tenantId: baseline.tenantAId,
    adminMembershipId: baseline.adminMembershipId,
    adminRoles: baseline.adminRoles,
    buildingA1Id: baseline.buildingA1Id,
    buildingA2Id: baseline.buildingA2Id,
    baseCurrency: 'ARS',
  });

  const context = await resolveFin07dFixtureContext(prisma);
  await unregisterFin07dMutableLiquidations(registeredLiquidationIds, databaseUrl);
  return context;
}
