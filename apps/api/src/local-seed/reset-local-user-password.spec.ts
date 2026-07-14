import * as bcrypt from 'bcrypt';
import { MemberStatus, Role, ScopeType, UnitOccupantRole } from '@prisma/client';
import {
  LOCAL_RESET_DATABASE,
  LOCAL_RESET_EMAIL,
  LOCAL_RESET_PASSWORD_HASH_ROUNDS,
  assertConnectedToBuildingOS,
  assertSafeLocalResetEnvironment,
  applyLocalUserPasswordReset,
  inspectLocalUserPasswordReset,
  readLocalResetCredentials,
  type LocalResetTransactionClient,
  type LocalResetWritableClient,
} from './reset-local-user-password';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

function buildEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://buildingos:secret@127.0.0.1:5434/buildingos?schema=public',
    LOCAL_RESET_EMAIL: LOCAL_RESET_EMAIL,
    LOCAL_RESET_PASSWORD: 'NewSecret123!',
    ...overrides,
  };
}

function buildUserQuery(passwordHash: string, activeSessionIds: readonly string[] = ['session-1']) {
  return [
    {
      id: 'user-1',
      email: LOCAL_RESET_EMAIL,
      name: 'Residente 2',
      passwordHash,
      memberships: [
        {
          id: 'membership-1',
          tenantId: 'tenant-1',
          tenant: { name: 'BuildingOS' },
          roles: [
            { role: Role.RESIDENT, scopeType: ScopeType.TENANT },
          ],
        },
      ],
      tenantMembers: [
        {
          id: 'tenant-member-1',
          tenantId: 'tenant-1',
          tenant: { name: 'BuildingOS' },
          role: Role.RESIDENT,
          status: MemberStatus.ACTIVE,
          disabledAt: null,
          occupancies: [
            {
              id: 'occupancy-1',
              unitId: 'unit-1',
              role: UnitOccupantRole.RESIDENT,
              isPrimary: true,
              endDate: null,
              unit: {
                code: 'A-01-02',
                label: 'Unidad A-01-02',
                building: {
                  id: 'building-1',
                  name: 'Torre Local A',
                  alias: 'torre-local-a',
                },
              },
            },
          ],
        },
      ],
      authSessions: activeSessionIds.map((id) => ({
        id,
        revokedAt: null,
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      })),
    },
  ];
}

function createMockPrisma(userQuery: ReturnType<typeof buildUserQuery>) {
  const tx: LocalResetTransactionClient = {
    $queryRaw: jest.fn().mockResolvedValue([
      {
        database: LOCAL_RESET_DATABASE,
        address: '127.0.0.1',
        port: 5434,
      },
    ]),
    user: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue(userQuery),
    },
    authSession: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };

  const prisma: LocalResetWritableClient = {
    $queryRaw: jest.fn().mockResolvedValue([
      {
        database: LOCAL_RESET_DATABASE,
        address: '127.0.0.1',
        port: 5434,
      },
    ]),
    user: {
      findMany: jest.fn().mockResolvedValue(userQuery),
    },
    $transaction: jest.fn(async (callback: (client: LocalResetTransactionClient) => Promise<unknown>) => callback(tx)),
  };

  return { prisma, tx };
}

describe('local user password reset', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts the authorized local target and required credentials', () => {
    const environment = buildEnvironment();
    expect(assertSafeLocalResetEnvironment(environment)).toEqual({
      database: LOCAL_RESET_DATABASE,
      host: '127.0.0.1',
    });
    expect(readLocalResetCredentials(environment)).toEqual({
      email: LOCAL_RESET_EMAIL,
      password: 'NewSecret123!',
    });
  });

  it.each([
    ['development', { NODE_ENV: 'development' }],
    ['test', { NODE_ENV: 'test' }],
    ['empty', { NODE_ENV: undefined }],
  ])('accepts %s as an allowed local runtime env', (_label, overrides) => {
    expect(assertSafeLocalResetEnvironment(buildEnvironment(overrides))).toEqual({
      database: LOCAL_RESET_DATABASE,
      host: '127.0.0.1',
    });
  });

  it.each([
    ['production', { NODE_ENV: 'production' }],
    ['staging', { NODE_ENV: 'staging' }],
    ['remote host', { DATABASE_URL: 'postgresql://buildingos:secret@db.example.com:5432/buildingos?schema=public' }],
    ['another database', { DATABASE_URL: 'postgresql://buildingos:secret@127.0.0.1:5434/other?schema=public' }],
    ['staging database', { DATABASE_URL: 'postgresql://buildingos:secret@127.0.0.1:5434/buildingos_staging?schema=public' }],
  ])('rejects %s', (_label, overrides) => {
    expect(() => assertSafeLocalResetEnvironment(buildEnvironment(overrides))).toThrow();
  });

  it('rejects a missing password and an unexpected email before any write', () => {
    expect(() => readLocalResetCredentials(buildEnvironment({ LOCAL_RESET_PASSWORD: undefined }))).toThrow('LOCAL_RESET_PASSWORD is required');
    expect(() => readLocalResetCredentials(buildEnvironment({ LOCAL_RESET_EMAIL: 'other@buildingos.test' }))).toThrow(`Local password reset only allows ${LOCAL_RESET_EMAIL}`);
  });

  it('diagnostic mode reads the account without writing', async () => {
    const { prisma, tx } = createMockPrisma(buildUserQuery('old-hash'));
    const target = assertSafeLocalResetEnvironment(buildEnvironment());
    const credentials = readLocalResetCredentials(buildEnvironment());

    const result = await inspectLocalUserPasswordReset(prisma, target, credentials);

    expect(result.connection.database).toBe(LOCAL_RESET_DATABASE);
    expect(result.snapshot.userId).toBe('user-1');
    expect(result.snapshot.activeOccupancyUnitCodes).toContain('A-01-02');
    expect('passwordHash' in result.snapshot).toBe(false);
    expect('rawUserId' in result.snapshot).toBe(false);
    expect((prisma.user.findMany as jest.Mock).mock.calls).toHaveLength(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.authSession.updateMany).not.toHaveBeenCalled();
  });

  it('hashes with bcrypt round 10 and produces a valid login password', async () => {
    const realBcrypt = jest.requireActual('bcrypt') as typeof import('bcrypt');
    const hash = await realBcrypt.hash('NewSecret123!', 10);
    expect(LOCAL_RESET_PASSWORD_HASH_ROUNDS).toBe(10);
    await expect(realBcrypt.compare('NewSecret123!', hash)).resolves.toBe(true);
    await expect(realBcrypt.compare('OldSecret123!', hash)).resolves.toBe(false);
  });

  it('apply mode changes only the password hash and revokes sessions', async () => {
    const beforeQuery = buildUserQuery('old-hash', ['session-1', 'session-2']);
    const afterQuery = buildUserQuery('new-hash', ['session-1', 'session-2']);
    const { prisma, tx } = createMockPrisma(beforeQuery);
    (prisma.user.findMany as jest.Mock)
      .mockResolvedValueOnce(beforeQuery)
      .mockResolvedValueOnce(afterQuery);
    (tx.user.findMany as jest.Mock)
      .mockResolvedValueOnce(beforeQuery)
      .mockResolvedValueOnce(afterQuery);
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');

    const target = assertSafeLocalResetEnvironment(buildEnvironment());
    const credentials = readLocalResetCredentials(buildEnvironment());
    const result = await applyLocalUserPasswordReset(prisma, target, credentials);

    expect(result.snapshot.userId).toBe('user-1');
    expect('passwordHash' in result.snapshot).toBe(false);
    expect('rawUserId' in result.snapshot).toBe(false);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: 'hashed-password' },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.authSession.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        revokedAt: null,
      },
      data: {
        revokedAt: expect.any(Date),
      },
    });
    expect(result.revokedSessionCount).toBe(1);
    expect(result.snapshot.activeOccupancyUnitCodes).toContain('A-01-02');
  });

  it('is idempotent when applying the same password twice', async () => {
    const beforeQuery = buildUserQuery('old-hash', ['session-1']);
    const afterQuery = buildUserQuery('new-hash', ['session-1']);
    const { prisma, tx } = createMockPrisma(beforeQuery);
    (prisma.user.findMany as jest.Mock)
      .mockResolvedValueOnce(beforeQuery)
      .mockResolvedValueOnce(afterQuery)
      .mockResolvedValueOnce(afterQuery)
      .mockResolvedValueOnce(afterQuery);
    (tx.user.findMany as jest.Mock)
      .mockResolvedValueOnce(beforeQuery)
      .mockResolvedValueOnce(afterQuery)
      .mockResolvedValueOnce(afterQuery)
      .mockResolvedValueOnce(afterQuery);
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
    (tx.authSession.updateMany as jest.Mock)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const target = assertSafeLocalResetEnvironment(buildEnvironment());
    const credentials = readLocalResetCredentials(buildEnvironment());

    const first = await applyLocalUserPasswordReset(prisma, target, credentials);
    const second = await applyLocalUserPasswordReset(prisma, target, credentials);

    expect(first.snapshot).toEqual(second.snapshot);
    expect(tx.user.update).toHaveBeenCalledTimes(2);
    expect(tx.authSession.updateMany).toHaveBeenCalledTimes(2);
    expect(first.revokedSessionCount).toBe(1);
    expect(second.revokedSessionCount).toBe(0);
  });

  it('rejects an unexpected database identity before writing', async () => {
    const { prisma } = createMockPrisma(buildUserQuery('old-hash'));
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ database: 'other', address: '127.0.0.1', port: 5434 }]);

    await expect(assertConnectedToBuildingOS(prisma, { database: LOCAL_RESET_DATABASE, host: '127.0.0.1' })).rejects.toThrow();
  });
});
