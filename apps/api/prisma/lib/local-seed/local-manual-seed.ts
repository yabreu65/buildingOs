import * as bcrypt from 'bcrypt';
import {
  BillingPlanId,
  MemberStatus,
  Prisma,
  PrismaClient,
  Role,
  ScopeType,
  SubscriptionStatus,
  TenantType,
  UnitOccupantRole,
} from '@prisma/client';

export const LOCAL_MANUAL_SEED = {
  database: 'buildingos',
  tenantName: 'Administración Autogestionada Local',
  buildingName: 'Torre Local A',
  buildingAlias: 'torre-local-a',
  plan: {
    planId: BillingPlanId.FREE,
    name: 'Free',
    description: 'Local manual testing tier',
    monthlyPrice: 0,
    maxBuildings: 1,
    maxUnits: 10,
    maxUsers: 3,
    maxOccupants: 20,
    canExportReports: false,
    canBulkOperations: false,
    canUseAI: false,
    aiBudgetCents: 0,
    aiCallsMonthlyLimit: 0,
    aiAllowBigModel: false,
    aiConsultationsLimit: 0,
    supportLevel: 'COMMUNITY',
  },
  units: [
    { code: 'A-01-01', label: 'Torre Local A - Piso 01 - Unidad 01', occupancyStatus: 'OCCUPIED' },
    { code: 'A-01-02', label: 'Torre Local A - Piso 01 - Unidad 02', occupancyStatus: 'OCCUPIED' },
    { code: 'A-02-01', label: 'Torre Local A - Piso 02 - Unidad 01', occupancyStatus: 'VACANT' },
  ],
} as const;

interface SeedEnvironment {
  readonly [key: string]: string | undefined;
  readonly NODE_ENV?: string;
  readonly DATABASE_URL?: string;
  readonly LOCAL_SEED_ADMIN_EMAIL?: string;
  readonly LOCAL_SEED_ADMIN_PASSWORD?: string;
  readonly LOCAL_SEED_RESIDENT_1_EMAIL?: string;
  readonly LOCAL_SEED_RESIDENT_1_PASSWORD?: string;
  readonly LOCAL_SEED_RESIDENT_2_EMAIL?: string;
  readonly LOCAL_SEED_RESIDENT_2_PASSWORD?: string;
}

export interface LocalSeedTarget {
  readonly database: string;
  readonly host: string;
}

export interface LocalSeedEmails {
  readonly admin: string;
  readonly resident1: string;
  readonly resident2: string;
}

export interface LocalSeedCredentials extends LocalSeedEmails {
  readonly adminPassword: string;
  readonly resident1Password: string;
  readonly resident2Password: string;
}

interface ConnectionInfo {
  readonly database: string;
  readonly user: string;
  readonly address: string | null;
  readonly port: number | null;
}

export interface SeedRecordResult {
  readonly id: string;
  readonly created: boolean;
}

export interface LocalManualSeedResult {
  readonly target: LocalSeedTarget;
  readonly tenant: SeedRecordResult;
  readonly building: SeedRecordResult;
  readonly subscription: SeedRecordResult;
  readonly units: readonly SeedRecordResult[];
  readonly users: readonly SeedRecordResult[];
  readonly memberships: readonly SeedRecordResult[];
  readonly tenantMembers: readonly SeedRecordResult[];
  readonly occupancies: readonly SeedRecordResult[];
  readonly financialCounts: Readonly<Record<'expenses' | 'liquidations' | 'charges' | 'payments', number>>;
}

export interface SeedUserSpec {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly passwordHash: string;
  readonly role: Role;
  readonly unitCode?: string;
}

interface FinancialCounts {
  readonly expenses: number;
  readonly liquidations: number;
  readonly charges: number;
  readonly payments: number;
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const LOCAL_ALLOWED_NODE_ENVS = new Set(['', 'development', 'test']);
const LOCAL_EMAIL_SUFFIX = '@buildingos.test';

function required(environment: SeedEnvironment, name: keyof SeedEnvironment): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function normalizeEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized.endsWith(LOCAL_EMAIL_SUFFIX)) {
    throw new Error(`Local seed emails must end with ${LOCAL_EMAIL_SUFFIX}`);
  }
  return normalized;
}

function assertAllowedLocalNodeEnv(nodeEnv: string | undefined, scope: string): void {
  const normalized = nodeEnv?.trim().toLowerCase() ?? '';

  if (normalized === 'production' || normalized === 'staging') {
    throw new Error(`${scope} refuses to run when NODE_ENV=${normalized}`);
  }

  if (!LOCAL_ALLOWED_NODE_ENVS.has(normalized)) {
    throw new Error(`${scope} only allows NODE_ENV=development, test, or empty. Received: ${normalized || 'empty'}`);
  }
}

/** Validates only the configured target, before creating a Prisma client. */
export function assertSafeLocalSeedEnvironment(environment: SeedEnvironment): LocalSeedTarget {
  assertAllowedLocalNodeEnv(environment.NODE_ENV, 'Local manual seed');

  const databaseUrl = required(environment, 'DATABASE_URL');
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('Local manual seed requires a PostgreSQL DATABASE_URL');
  }

  const host = parsed.hostname.toLowerCase();
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Local manual seed refuses non-local host: ${host}`);
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, '')).split('/')[0] ?? '';
  if (!database || /(staging|production|prod)/i.test(database)) {
    throw new Error('Local manual seed refuses staging, production, or prod database names');
  }
  if (database !== LOCAL_MANUAL_SEED.database) {
    throw new Error(`Local manual seed requires database ${LOCAL_MANUAL_SEED.database}, received ${database}`);
  }

  return { database, host };
}

export function readSeedEmails(environment: SeedEnvironment): LocalSeedEmails {
  return {
    admin: normalizeEmail(required(environment, 'LOCAL_SEED_ADMIN_EMAIL')),
    resident1: normalizeEmail(required(environment, 'LOCAL_SEED_RESIDENT_1_EMAIL')),
    resident2: normalizeEmail(required(environment, 'LOCAL_SEED_RESIDENT_2_EMAIL')),
  };
}

export function readApplyCredentials(environment: SeedEnvironment): LocalSeedCredentials {
  return {
    ...readSeedEmails(environment),
    adminPassword: required(environment, 'LOCAL_SEED_ADMIN_PASSWORD'),
    resident1Password: required(environment, 'LOCAL_SEED_RESIDENT_1_PASSWORD'),
    resident2Password: required(environment, 'LOCAL_SEED_RESIDENT_2_PASSWORD'),
  };
}

async function readConnectionInfo(prisma: PrismaClient): Promise<ConnectionInfo> {
  const rows = await prisma.$queryRaw<ConnectionInfo[]>(Prisma.sql`
    SELECT
      current_database() AS "database",
      current_user AS "user",
      inet_server_addr()::text AS "address",
      inet_server_port() AS "port"
  `);
  const connection = rows[0];
  if (!connection) {
    throw new Error('Could not determine the current PostgreSQL database');
  }
  return connection;
}

async function assertConnectedDatabase(prisma: PrismaClient, target: LocalSeedTarget): Promise<ConnectionInfo> {
  const connection = await readConnectionInfo(prisma);
  if (connection.database !== target.database) {
    throw new Error(`Local manual seed connected to ${connection.database}, expected ${target.database}`);
  }
  return connection;
}

async function financialCounts(client: Prisma.TransactionClient): Promise<FinancialCounts> {
  const [expenses, liquidations, charges, payments] = await Promise.all([
    client.expense.count(),
    client.liquidation.count(),
    client.charge.count(),
    client.payment.count(),
  ]);
  return { expenses, liquidations, charges, payments };
}

function sameFinancialCounts(left: FinancialCounts, right: FinancialCounts): boolean {
  return left.expenses === right.expenses
    && left.liquidations === right.liquidations
    && left.charges === right.charges
    && left.payments === right.payments;
}

export function assertFreePlanCompatibility(plan: {
  readonly name: string;
  readonly monthlyPrice: number;
  readonly maxBuildings: number;
  readonly maxUnits: number;
  readonly maxUsers: number;
  readonly maxOccupants: number;
  readonly canExportReports: boolean;
  readonly canBulkOperations: boolean;
  readonly canUseAI: boolean;
  readonly aiBudgetCents: number;
  readonly aiCallsMonthlyLimit: number;
  readonly aiAllowBigModel: boolean;
  readonly aiConsultationsLimit: number;
  readonly supportLevel: string;
}): void {
  const expected = LOCAL_MANUAL_SEED.plan;
  const compatible = plan.name === expected.name
    && plan.monthlyPrice === expected.monthlyPrice
    && plan.maxBuildings >= expected.maxBuildings
    && plan.maxUnits >= expected.maxUnits
    && plan.maxUsers >= expected.maxUsers
    && plan.maxOccupants >= expected.maxOccupants
    && plan.canExportReports === expected.canExportReports
    && plan.canBulkOperations === expected.canBulkOperations
    && plan.canUseAI === expected.canUseAI
    && plan.aiBudgetCents === expected.aiBudgetCents
    && plan.aiCallsMonthlyLimit === expected.aiCallsMonthlyLimit
    && plan.aiAllowBigModel === expected.aiAllowBigModel
    && plan.aiConsultationsLimit === expected.aiConsultationsLimit
    && plan.supportLevel === expected.supportLevel;

  if (!compatible) {
    throw new Error('Existing FREE billing plan is incompatible with the local manual seed contract');
  }
}

export function assertLocalManualTenantCompatibility(tenant: { readonly type: TenantType; readonly isDemo: boolean }): void {
  if (tenant.type !== TenantType.ADMINISTRADORA || tenant.isDemo) {
    throw new Error('Existing local manual tenant is incompatible with ADMINISTRADORA local setup');
  }
}

export function assertLocalManualUserCompatibility(user: { readonly name: string }, spec: SeedUserSpec): void {
  if (user.name !== spec.name) {
    throw new Error(`Existing user ${spec.email} has an incompatible name`);
  }
}

export function assertLocalManualBuildingCompatibility(building: {
  readonly name: string;
  readonly deletedAt: Date | null;
}): void {
  if (building.name !== LOCAL_MANUAL_SEED.buildingName || building.deletedAt !== null) {
    throw new Error('Existing local manual building is incompatible or deleted');
  }
}

export function assertLocalManualUnitCompatibility(unit: {
  readonly tenantId: string;
  readonly label: string | null;
  readonly occupancyStatus: string;
  readonly isBillable: boolean;
}, tenantId: string, unitSpec: (typeof LOCAL_MANUAL_SEED.units)[number]): void {
  if (unit.tenantId !== tenantId || unit.label !== unitSpec.label || unit.occupancyStatus !== unitSpec.occupancyStatus || !unit.isBillable) {
    throw new Error(`Existing unit ${unitSpec.code} is incompatible with the local manual seed`);
  }
}

export function assertLocalManualTenantMemberCompatibility(member: {
  readonly userId: string | null;
  readonly name: string;
  readonly role: Role;
  readonly status: MemberStatus;
  readonly disabledAt: Date | null;
}, userId: string, spec: SeedUserSpec): void {
  if (member.userId !== userId || member.name !== spec.name || member.role !== spec.role || member.status !== MemberStatus.ACTIVE || member.disabledAt !== null) {
    throw new Error(`Existing tenant member ${spec.email} is incompatible with the local manual seed`);
  }
}

export function assertLocalManualOccupancyCompatibility(occupancy: {
  readonly tenantId: string;
  readonly role: UnitOccupantRole;
  readonly isPrimary: boolean;
  readonly endDate: Date | null;
}, tenantId: string, email: string): void {
  if (occupancy.tenantId !== tenantId || occupancy.role !== UnitOccupantRole.RESIDENT || !occupancy.isPrimary || occupancy.endDate !== null) {
    throw new Error(`Existing occupancy for ${email} is incompatible with the local manual seed`);
  }
}

async function ensureUser(
  tx: Prisma.TransactionClient,
  spec: SeedUserSpec,
): Promise<SeedRecordResult> {
  const existing = await tx.user.findUnique({
    where: { email: spec.email },
  });

  if (existing) {
    assertLocalManualUserCompatibility(existing, spec);
    if (!(await bcrypt.compare(spec.password, existing.passwordHash))) {
      throw new Error(`Existing user ${spec.email} does not match the supplied local seed password`);
    }
    return { id: existing.id, created: false };
  }

  const created = await tx.user.create({
    data: { email: spec.email, name: spec.name, passwordHash: spec.passwordHash },
  });
  return { id: created.id, created: true };
}

async function assertUserHasNoOtherTenantMembership(
  tx: Prisma.TransactionClient,
  userId: string,
  tenantId: string,
  email: string,
): Promise<void> {
  const otherMembership = await tx.membership.findFirst({
    where: { userId, tenantId: { not: tenantId } },
    select: { id: true },
  });
  if (otherMembership) {
    throw new Error(`Existing user ${email} belongs to a different tenant`);
  }
}

async function ensureMembership(
  tx: Prisma.TransactionClient,
  userId: string,
  tenantId: string,
): Promise<SeedRecordResult> {
  const existing = await tx.membership.findUnique({ where: { userId_tenantId: { userId, tenantId } } });
  if (existing) {
    return { id: existing.id, created: false };
  }
  const created = await tx.membership.create({ data: { userId, tenantId } });
  return { id: created.id, created: true };
}

async function ensureTenantRole(
  tx: Prisma.TransactionClient,
  tenantId: string,
  membershipId: string,
  role: Role,
): Promise<void> {
  const existing = await tx.membershipRole.findMany({
    where: { tenantId, membershipId, role, scopeType: ScopeType.TENANT },
    select: { id: true, scopeBuildingId: true, scopeUnitId: true },
  });
  if (existing.length > 1) {
    throw new Error(`Membership ${membershipId} has duplicate ${role} tenant roles`);
  }
  if (existing.length === 1) {
    const current = existing[0];
    if (current?.scopeBuildingId !== null || current.scopeUnitId !== null) {
      throw new Error(`Membership ${membershipId} has an incompatible ${role} role scope`);
    }
    return;
  }
  await tx.membershipRole.create({ data: { tenantId, membershipId, role, scopeType: ScopeType.TENANT } });
}

async function ensureTenantMember(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  spec: SeedUserSpec,
): Promise<SeedRecordResult> {
  const existing = await tx.tenantMember.findUnique({ where: { tenantId_email: { tenantId, email: spec.email } } });
  if (existing) {
    assertLocalManualTenantMemberCompatibility(existing, userId, spec);
    return { id: existing.id, created: false };
  }
  const created = await tx.tenantMember.create({
    data: {
      tenantId,
      userId,
      name: spec.name,
      email: spec.email,
      role: spec.role,
      status: MemberStatus.ACTIVE,
    },
  });
  return { id: created.id, created: true };
}

async function ensureResidentOccupancy(
  tx: Prisma.TransactionClient,
  tenantId: string,
  unitId: string,
  memberId: string,
  email: string,
): Promise<SeedRecordResult> {
  const activeElsewhere = await tx.unitOccupant.findFirst({
    where: { tenantId, memberId, endDate: null, unitId: { not: unitId } },
    select: { id: true },
  });
  if (activeElsewhere) {
    throw new Error(`Resident ${email} already has an active occupancy in another unit`);
  }

  const activeUnitOccupant = await tx.unitOccupant.findFirst({
    where: { tenantId, unitId, endDate: null },
    select: { id: true, memberId: true },
  });
  if (activeUnitOccupant && activeUnitOccupant.memberId !== memberId) {
    throw new Error(`Target unit for ${email} already has an incompatible active occupant`);
  }

  const existing = await tx.unitOccupant.findUnique({ where: { unitId_memberId: { unitId, memberId } } });
  if (existing) {
    assertLocalManualOccupancyCompatibility(existing, tenantId, email);
    return { id: existing.id, created: false };
  }

  const created = await tx.unitOccupant.create({
    data: { tenantId, unitId, memberId, role: UnitOccupantRole.RESIDENT, isPrimary: true, endDate: null },
  });
  return { id: created.id, created: true };
}

export async function inspectLocalManualSeed(prisma: PrismaClient, target: LocalSeedTarget, emails: LocalSeedEmails): Promise<{
  readonly connection: ConnectionInfo;
  readonly existing: Readonly<Record<'plan' | 'tenant' | 'building' | 'units' | 'users', number>>;
  readonly missingPasswords: readonly string[];
}> {
  const connection = await assertConnectedDatabase(prisma, target);
  const [plan, tenant, users] = await Promise.all([
    prisma.billingPlan.findUnique({ where: { planId: BillingPlanId.FREE } }),
    prisma.tenant.findUnique({ where: { name: LOCAL_MANUAL_SEED.tenantName } }),
    prisma.user.count({ where: { email: { in: [emails.admin, emails.resident1, emails.resident2] } } }),
  ]);
  const building = tenant
    ? await prisma.building.findUnique({ where: { tenantId_alias: { tenantId: tenant.id, alias: LOCAL_MANUAL_SEED.buildingAlias } } })
    : null;
  const units = building && tenant
    ? await prisma.unit.count({ where: { tenantId: tenant.id, buildingId: building.id, code: { in: LOCAL_MANUAL_SEED.units.map((unit) => unit.code) } } })
    : 0;

  return {
    connection,
    existing: { plan: plan ? 1 : 0, tenant: tenant ? 1 : 0, building: building ? 1 : 0, units, users },
    missingPasswords: [],
  };
}

/** Creates or reuses the local manual dataset in one serializable transaction. */
export async function applyLocalManualSeed(
  prisma: PrismaClient,
  target: LocalSeedTarget,
  credentials: LocalSeedCredentials,
): Promise<LocalManualSeedResult> {
  await assertConnectedDatabase(prisma, target);
  const [adminPasswordHash, resident1PasswordHash, resident2PasswordHash] = await Promise.all([
    bcrypt.hash(credentials.adminPassword, 10),
    bcrypt.hash(credentials.resident1Password, 10),
    bcrypt.hash(credentials.resident2Password, 10),
  ]);

  return prisma.$transaction(async (tx) => {
    const beforeFinancial = await financialCounts(tx);
    const planExisting = await tx.billingPlan.findUnique({ where: { planId: BillingPlanId.FREE } });
    if (planExisting) {
      assertFreePlanCompatibility(planExisting);
    }
    const plan = planExisting ?? await tx.billingPlan.create({ data: LOCAL_MANUAL_SEED.plan });
    const planResult = { id: plan.id, created: !planExisting };

    const existingTenant = await tx.tenant.findUnique({ where: { name: LOCAL_MANUAL_SEED.tenantName } });
    if (existingTenant) {
      assertLocalManualTenantCompatibility(existingTenant);
    }
    const tenant = existingTenant ?? await tx.tenant.create({
      data: { name: LOCAL_MANUAL_SEED.tenantName, type: TenantType.ADMINISTRADORA, isDemo: false },
    });
    const tenantResult = { id: tenant.id, created: !existingTenant };

    const existingSubscription = await tx.subscription.findUnique({ where: { tenantId: tenant.id } });
    if (existingSubscription && (existingSubscription.planId !== plan.id || existingSubscription.status !== SubscriptionStatus.ACTIVE || existingSubscription.currentPeriodEnd !== null)) {
      throw new Error('Existing local manual tenant subscription is incompatible with the FREE active subscription');
    }
    const subscription = existingSubscription ?? await tx.subscription.create({
      data: { tenantId: tenant.id, planId: plan.id, status: SubscriptionStatus.ACTIVE, currentPeriodEnd: null },
    });
    const subscriptionResult = { id: subscription.id, created: !existingSubscription };

    const aliasElsewhere = await tx.building.findFirst({
      where: { alias: LOCAL_MANUAL_SEED.buildingAlias, tenantId: { not: tenant.id } },
      select: { id: true },
    });
    if (aliasElsewhere) {
      throw new Error(`Building alias ${LOCAL_MANUAL_SEED.buildingAlias} already belongs to another tenant`);
    }
    const existingBuilding = await tx.building.findUnique({
      where: { tenantId_alias: { tenantId: tenant.id, alias: LOCAL_MANUAL_SEED.buildingAlias } },
    });
    if (existingBuilding) {
      assertLocalManualBuildingCompatibility(existingBuilding);
    }
    const building = existingBuilding ?? await tx.building.create({
      data: { tenantId: tenant.id, name: LOCAL_MANUAL_SEED.buildingName, alias: LOCAL_MANUAL_SEED.buildingAlias, deletedAt: null },
    });
    const buildingResult = { id: building.id, created: !existingBuilding };

    const unitResults: SeedRecordResult[] = [];
    const unitsByCode = new Map<string, { id: string }>();
    for (const unitSpec of LOCAL_MANUAL_SEED.units) {
      const existingUnit = await tx.unit.findUnique({ where: { buildingId_code: { buildingId: building.id, code: unitSpec.code } } });
      if (existingUnit) {
        assertLocalManualUnitCompatibility(existingUnit, tenant.id, unitSpec);
      }
      const unit = existingUnit ?? await tx.unit.create({
        data: {
          tenantId: tenant.id,
          buildingId: building.id,
          code: unitSpec.code,
          label: unitSpec.label,
          unitType: 'APARTAMENTO',
          occupancyStatus: unitSpec.occupancyStatus,
          isBillable: true,
        },
      });
      unitResults.push({ id: unit.id, created: !existingUnit });
      unitsByCode.set(unitSpec.code, unit);
    }

    const userSpecs: readonly SeedUserSpec[] = [
      { name: 'Administrador Local', email: credentials.admin, password: credentials.adminPassword, passwordHash: adminPasswordHash, role: Role.TENANT_OWNER },
      { name: 'Residente Local 1', email: credentials.resident1, password: credentials.resident1Password, passwordHash: resident1PasswordHash, role: Role.RESIDENT, unitCode: 'A-01-01' },
      { name: 'Residente Local 2', email: credentials.resident2, password: credentials.resident2Password, passwordHash: resident2PasswordHash, role: Role.RESIDENT, unitCode: 'A-01-02' },
    ];

    const users: SeedRecordResult[] = [];
    const memberships: SeedRecordResult[] = [];
    const tenantMembers: SeedRecordResult[] = [];
    const occupancies: SeedRecordResult[] = [];
    for (const userSpec of userSpecs) {
      const user = await ensureUser(tx, userSpec);
      await assertUserHasNoOtherTenantMembership(tx, user.id, tenant.id, userSpec.email);
      const membership = await ensureMembership(tx, user.id, tenant.id);
      await ensureTenantRole(tx, tenant.id, membership.id, userSpec.role);
      const tenantMember = await ensureTenantMember(tx, tenant.id, user.id, userSpec);
      users.push(user);
      memberships.push(membership);
      tenantMembers.push(tenantMember);

      if (userSpec.unitCode) {
        const unit = unitsByCode.get(userSpec.unitCode);
        if (!unit) {
          throw new Error(`Missing expected unit ${userSpec.unitCode}`);
        }
        occupancies.push(await ensureResidentOccupancy(tx, tenant.id, unit.id, tenantMember.id, userSpec.email));
      }
    }

    const vacantUnit = unitsByCode.get('A-02-01');
    if (!vacantUnit) {
      throw new Error('Missing expected vacant unit A-02-01');
    }
    const unexpectedVacantOccupant = await tx.unitOccupant.findFirst({
      where: { tenantId: tenant.id, unitId: vacantUnit.id, endDate: null },
      select: { id: true },
    });
    if (unexpectedVacantOccupant) {
      throw new Error('Unit A-02-01 must remain vacant for the local manual seed');
    }

    const afterFinancial = await financialCounts(tx);
    if (!sameFinancialCounts(beforeFinancial, afterFinancial)) {
      throw new Error('Local manual seed must not create financial records');
    }

    return {
      target,
      tenant: tenantResult,
      building: buildingResult,
      subscription: subscriptionResult,
      units: unitResults,
      users,
      memberships,
      tenantMembers,
      occupancies,
      financialCounts: afterFinancial,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
