import { Prisma, PrismaClient, MemberStatus, Role, ScopeType, UnitOccupantRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

export const LOCAL_RESET_EMAIL = 'residente2.local@buildingos.test';
export const LOCAL_RESET_DATABASE = 'buildingos';
export const LOCAL_RESET_PASSWORD_HASH_ROUNDS = 10;

const LOCAL_RESET_ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1']);
const LOCAL_RESET_ALLOWED_NODE_ENVS = new Set(['', 'development', 'test']);

interface ResetEnvironment {
  readonly [key: string]: string | undefined;
  readonly NODE_ENV?: string;
  readonly DATABASE_URL?: string;
  readonly LOCAL_RESET_EMAIL?: string;
  readonly LOCAL_RESET_PASSWORD?: string;
}

export interface LocalResetTarget {
  readonly database: string;
  readonly host: string;
}

export interface LocalResetCredentials {
  readonly email: string;
  readonly password: string;
}

interface LocalResetConnection {
  readonly database: string;
  readonly address: string | null;
  readonly port: number | null;
}

export interface LocalResetBaseClient {
  $queryRaw<T>(query: Prisma.Sql): Promise<T>;
  user: {
    findMany(args: {
      where: {
        email: string;
      };
      include: typeof localResetUserInclude;
    }): Promise<LocalResetUserQuery[]>;
  };
}

export interface LocalResetTransactionClient extends LocalResetBaseClient {
  user: LocalResetBaseClient['user'] & {
    update(args: {
      where: {
        id: string;
      };
      data: {
        passwordHash: string;
      };
    }): Promise<unknown>;
  };
  authSession: {
    updateMany(args: {
      where: {
        userId: string;
        revokedAt: null;
      };
      data: {
        revokedAt: Date;
      };
    }): Promise<{ count: number }>;
  };
}

export interface LocalResetWritableClient extends LocalResetBaseClient {
  $transaction<R>(
    callback: (tx: LocalResetTransactionClient) => Promise<R>,
    options?: {
      isolationLevel?: Prisma.TransactionIsolationLevel;
    },
  ): Promise<R>;
}

interface LocalResetRoleSnapshot {
  readonly role: Role;
  readonly scopeType: ScopeType;
}

interface LocalResetMembershipSnapshot {
  readonly id: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly roles: readonly LocalResetRoleSnapshot[];
}

interface LocalResetOccupancySnapshot {
  readonly id: string;
  readonly unitId: string;
  readonly unitCode: string;
  readonly unitLabel: string | null;
  readonly buildingId: string;
  readonly buildingName: string;
  readonly buildingAlias: string;
  readonly role: UnitOccupantRole;
  readonly isPrimary: boolean;
  readonly endDate: Date | null;
}

interface LocalResetTenantMemberSnapshot {
  readonly id: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly role: Role;
  readonly status: MemberStatus;
  readonly disabledAt: Date | null;
  readonly occupancies: readonly LocalResetOccupancySnapshot[];
}

interface LocalResetSessionSnapshot {
  readonly id: string;
  readonly revokedAt: Date | null;
  readonly expiresAt: Date;
}

export interface LocalResetSnapshot {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly membershipIds: readonly string[];
  readonly membershipRoles: readonly string[];
  readonly tenantMemberIds: readonly string[];
  readonly activeTenantMemberIds: readonly string[];
  readonly activeOccupancyIds: readonly string[];
  readonly activeOccupancyUnitCodes: readonly string[];
  readonly activeOccupancyUnitId: string | null;
  readonly activeOccupancyBuildingId: string | null;
  readonly activeSessionIds: readonly string[];
  readonly activeSessionCount: number;
}

export interface LocalResetResult {
  readonly target: LocalResetTarget;
  readonly connection: LocalResetConnection;
  readonly snapshot: LocalResetSnapshot;
  readonly revokedSessionCount: number;
}

interface LocalResetUserQuery {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly passwordHash: string;
  readonly memberships: readonly {
    readonly id: string;
    readonly tenantId: string;
    readonly tenant: {
      readonly name: string;
    };
    readonly roles: readonly {
      readonly role: Role;
      readonly scopeType: ScopeType;
    }[];
  }[];
  readonly tenantMembers: readonly {
    readonly id: string;
    readonly tenantId: string;
    readonly tenant: {
      readonly name: string;
    };
    readonly role: Role;
    readonly status: MemberStatus;
    readonly disabledAt: Date | null;
    readonly occupancies: readonly {
      readonly id: string;
      readonly unitId: string;
      readonly role: UnitOccupantRole;
      readonly isPrimary: boolean;
      readonly endDate: Date | null;
      readonly unit: {
        readonly code: string;
        readonly label: string | null;
        readonly building: {
          readonly id: string;
          readonly name: string;
          readonly alias: string;
        };
      };
    }[];
  }[];
  readonly authSessions: readonly {
    readonly id: string;
    readonly revokedAt: Date | null;
    readonly expiresAt: Date;
  }[];
}

const localResetUserInclude = {
  memberships: {
    include: {
      tenant: {
        select: {
          name: true,
        },
      },
      roles: {
        select: {
          role: true,
          scopeType: true,
        },
      },
    },
  },
  tenantMembers: {
    include: {
      tenant: {
        select: {
          name: true,
        },
      },
      occupancies: {
        where: {
          endDate: null,
        },
        include: {
          unit: {
            select: {
              code: true,
              label: true,
              building: {
                select: {
                  id: true,
                  name: true,
                  alias: true,
                },
              },
            },
          },
        },
      },
    },
  },
  authSessions: {
    where: {
      revokedAt: null,
    },
    select: {
      id: true,
      revokedAt: true,
      expiresAt: true,
    },
  },
} as const;

function abort(message: string): never {
  throw new Error(message);
}

function required(environment: ResetEnvironment, key: keyof ResetEnvironment): string {
  const value = environment[key]?.trim();
  if (!value) {
    abort(`${key} is required`);
  }
  return value;
}

function parseDatabaseName(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    abort('DATABASE_URL must be a valid PostgreSQL URL');
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    abort('DATABASE_URL must use the PostgreSQL protocol');
  }

  const host = parsed.hostname.toLowerCase();
  if (!LOCAL_RESET_ALLOWED_HOSTS.has(host)) {
    abort(`DATABASE_URL host must be localhost or 127.0.0.1, received ${host}`);
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, '')).split('/')[0] ?? '';
  if (!database) {
    abort('DATABASE_URL must include a database name');
  }
  if (/(staging|production|prod)/i.test(database)) {
    abort('DATABASE_URL cannot point to staging, production, or prod databases');
  }
  if (database !== LOCAL_RESET_DATABASE) {
    abort(`DATABASE_URL must target ${LOCAL_RESET_DATABASE}, received ${database}`);
  }

  return database;
}

function assertAllowedLocalNodeEnv(nodeEnv: string | undefined): void {
  const normalized = nodeEnv?.trim().toLowerCase() ?? '';

  if (normalized === 'production' || normalized === 'staging') {
    abort(`Local password reset refuses to run when NODE_ENV=${normalized}`);
  }

  if (!LOCAL_RESET_ALLOWED_NODE_ENVS.has(normalized)) {
    abort(`Local password reset only allows NODE_ENV=development, test, or empty. Received: ${normalized || 'empty'}`);
  }
}

export function assertSafeLocalResetEnvironment(environment: ResetEnvironment): LocalResetTarget {
  assertAllowedLocalNodeEnv(environment.NODE_ENV);

  const databaseUrl = required(environment, 'DATABASE_URL');
  const database = parseDatabaseName(databaseUrl);
  const host = new URL(databaseUrl).hostname.toLowerCase();

  return {
    database,
    host,
  };
}

export function readLocalResetCredentials(environment: ResetEnvironment): LocalResetCredentials {
  const email = required(environment, 'LOCAL_RESET_EMAIL').toLowerCase();
  if (email !== LOCAL_RESET_EMAIL) {
    abort(`Local password reset only allows ${LOCAL_RESET_EMAIL}`);
  }
  if (!email.endsWith('@buildingos.test')) {
    abort('LOCAL_RESET_EMAIL must end with @buildingos.test');
  }

  const password = required(environment, 'LOCAL_RESET_PASSWORD');
  return {
    email,
    password,
  };
}

async function readConnection(client: LocalResetBaseClient): Promise<LocalResetConnection> {
  const rows = await client.$queryRaw<LocalResetConnection[]>(Prisma.sql`
    SELECT
      current_database() AS "database",
      inet_server_addr()::text AS "address",
      inet_server_port() AS "port"
  `);
  const connection = rows[0];
  if (!connection) {
    abort('Could not determine the active PostgreSQL connection');
  }
  return connection;
}

export async function assertConnectedToBuildingOS(client: LocalResetBaseClient, target: LocalResetTarget): Promise<LocalResetConnection> {
  const connection = await readConnection(client);
  if (connection.database !== target.database) {
    abort(`Local password reset connected to ${connection.database}, expected ${target.database}`);
  }
  if (!connection.address || !LOCAL_RESET_ALLOWED_HOSTS.has(connection.address.toLowerCase())) {
    abort(`Local password reset connected through non-local address: ${connection.address ?? 'unknown'}`);
  }
  return connection;
}

function sortStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function extractSnapshot(user: LocalResetUserQuery): LocalResetSnapshot {
  const membershipIds = sortStrings(user.memberships.map((membership) => membership.id));
  const membershipRoles = sortStrings(
    user.memberships.flatMap((membership) =>
      membership.roles.map((role) => `${role.role}:${role.scopeType}`),
    ),
  );
  const tenantMemberIds = sortStrings(user.tenantMembers.map((tenantMember) => tenantMember.id));
  const activeTenantMembers = user.tenantMembers.filter(
    (tenantMember) => tenantMember.role === Role.RESIDENT && tenantMember.status === MemberStatus.ACTIVE && tenantMember.disabledAt === null,
  );
  const activeOccupancies = activeTenantMembers.flatMap((tenantMember) => tenantMember.occupancies);
  const activeSessionIds = sortStrings(user.authSessions.map((session) => session.id));

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    membershipIds,
    membershipRoles,
    tenantMemberIds,
    activeTenantMemberIds: sortStrings(activeTenantMembers.map((tenantMember) => tenantMember.id)),
    activeOccupancyIds: sortStrings(activeOccupancies.map((occupancy) => occupancy.id)),
    activeOccupancyUnitCodes: sortStrings(activeOccupancies.map((occupancy) => occupancy.unit.code)),
    activeOccupancyUnitId: activeOccupancies[0]?.unitId ?? null,
    activeOccupancyBuildingId: activeOccupancies[0]?.unit.building.id ?? null,
    activeSessionIds,
    activeSessionCount: activeSessionIds.length,
  };
}

function assertExpectedSnapshot(snapshot: LocalResetSnapshot): void {
  if (snapshot.userId.length === 0) {
    abort('Local reset user snapshot is invalid');
  }
  if (!snapshot.membershipRoles.some((role) => role.startsWith('RESIDENT:'))) {
    abort('Local reset user must keep a RESIDENT membership role');
  }
  if (!snapshot.activeTenantMemberIds.length) {
    abort('Local reset user must keep an ACTIVE resident tenant member');
  }
  if (!snapshot.activeOccupancyIds.length) {
    abort('Local reset user must keep an active occupancy');
  }
  if (!snapshot.activeOccupancyUnitCodes.includes('A-01-02')) {
    abort('Local reset user must remain assigned to unit A-01-02');
  }
}

interface LoadedLocalResetUser {
  readonly snapshot: LocalResetSnapshot;
  readonly passwordHash: string;
  readonly rawUserId: string;
}

async function loadUserSnapshot(client: LocalResetBaseClient, email: string): Promise<LoadedLocalResetUser> {
  const users = (await client.user.findMany({
    where: {
      email,
    },
    include: localResetUserInclude,
  })) as LocalResetUserQuery[];

  if (users.length !== 1) {
    abort(`Expected exactly one local reset user for ${email}, found ${users.length}`);
  }

  const user = users[0];
  if (!user) {
    abort(`Expected exactly one local reset user for ${email}, found 0`);
  }
  const snapshot = extractSnapshot(user);
  assertExpectedSnapshot(snapshot);

  return {
    snapshot,
    passwordHash: user.passwordHash,
    rawUserId: user.id,
  };
}

export async function hashLocalResetPassword(password: string): Promise<string> {
  return bcrypt.hash(password, LOCAL_RESET_PASSWORD_HASH_ROUNDS);
}

export async function inspectLocalUserPasswordReset(
  client: LocalResetBaseClient,
  target: LocalResetTarget,
  credentials: LocalResetCredentials,
): Promise<LocalResetResult> {
  const connection = await assertConnectedToBuildingOS(client, target);
  const user = await loadUserSnapshot(client, credentials.email);
  return {
    target,
    connection,
    snapshot: user.snapshot,
    revokedSessionCount: 0,
  };
}

async function compareSnapshotIntegrity(before: LocalResetSnapshot, after: LocalResetSnapshot): Promise<void> {
  const beforeMembershipIds = sortStrings(before.membershipIds);
  const afterMembershipIds = sortStrings(after.membershipIds);
  const beforeTenantMemberIds = sortStrings(before.tenantMemberIds);
  const afterTenantMemberIds = sortStrings(after.tenantMemberIds);
  const beforeActiveTenantMemberIds = sortStrings(before.activeTenantMemberIds);
  const afterActiveTenantMemberIds = sortStrings(after.activeTenantMemberIds);
  const beforeOccupancyIds = sortStrings(before.activeOccupancyIds);
  const afterOccupancyIds = sortStrings(after.activeOccupancyIds);

  if (before.userId !== after.userId) {
    abort('User ID changed during local password reset');
  }
  if (JSON.stringify(beforeMembershipIds) !== JSON.stringify(afterMembershipIds)) {
    abort('Memberships changed during local password reset');
  }
  if (JSON.stringify(beforeTenantMemberIds) !== JSON.stringify(afterTenantMemberIds)) {
    abort('TenantMember records changed during local password reset');
  }
  if (JSON.stringify(beforeActiveTenantMemberIds) !== JSON.stringify(afterActiveTenantMemberIds)) {
    abort('Active TenantMember records changed during local password reset');
  }
  if (JSON.stringify(beforeOccupancyIds) !== JSON.stringify(afterOccupancyIds)) {
    abort('UnitOccupant records changed during local password reset');
  }
  if (JSON.stringify(sortStrings(before.activeOccupancyUnitCodes)) !== JSON.stringify(sortStrings(after.activeOccupancyUnitCodes))) {
    abort('Unit assignment changed during local password reset');
  }
}

export async function applyLocalUserPasswordReset(
  client: LocalResetWritableClient,
  target: LocalResetTarget,
  credentials: LocalResetCredentials,
): Promise<LocalResetResult> {
  const connection = await assertConnectedToBuildingOS(client, target);

  return client.$transaction(async (tx) => {
    const before = await loadUserSnapshot(tx, credentials.email);
    const passwordHash = await hashLocalResetPassword(credentials.password);

    await tx.user.update({
      where: {
        id: before.rawUserId,
      },
      data: {
        passwordHash,
      },
    });

    const revokedSessions = await tx.authSession.updateMany({
      where: {
        userId: before.rawUserId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    const after = await loadUserSnapshot(tx, credentials.email);
    await compareSnapshotIntegrity(before.snapshot, after.snapshot);

    return {
      target,
      connection,
      snapshot: after.snapshot,
      revokedSessionCount: revokedSessions.count,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

function formatSnapshotForOutput(result: LocalResetResult): string {
  return [
    'Local password reset',
    `Database: ${result.connection.database}`,
    `Address: ${result.connection.address ?? 'unknown'}`,
    `Port: ${result.connection.port ?? 'unknown'}`,
    `User: ${result.snapshot.email} (${result.snapshot.userId})`,
    `Memberships: ${result.snapshot.membershipIds.join(', ')}`,
    `TenantMembers: ${result.snapshot.tenantMemberIds.join(', ')}`,
    `Active unit: ${result.snapshot.activeOccupancyUnitCodes.join(', ')}`,
    `Active sessions revoked: ${result.revokedSessionCount}`,
  ].join('\n');
}

export async function main(argv = process.argv.slice(2), environment: ResetEnvironment = process.env): Promise<void> {
  const apply = argv.includes('--apply');
  const target = assertSafeLocalResetEnvironment(environment);
  const credentials = readLocalResetCredentials(environment);
  const databaseUrl = required(environment, 'DATABASE_URL');
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

  try {
    const diagnostic = await inspectLocalUserPasswordReset(prisma, target, credentials);
    if (!apply) {
      console.log(formatSnapshotForOutput(diagnostic));
      console.log('Mode: diagnostic');
      console.log('No data was written. Re-run with --apply to update only the password hash.');
      return;
    }

    const applied = await applyLocalUserPasswordReset(prisma, target, credentials);
    console.log(formatSnapshotForOutput(applied));
    console.log('Mode: apply');
    console.log('Only User.passwordHash and active AuthSession.revokedAt values were changed.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Local password reset failed: ${message}`);
    process.exit(1);
  });
}
