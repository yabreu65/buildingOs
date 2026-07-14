import {
  assertFreePlanCompatibility,
  assertLocalManualBuildingCompatibility,
  assertLocalManualOccupancyCompatibility,
  assertLocalManualTenantCompatibility,
  assertLocalManualTenantMemberCompatibility,
  assertLocalManualUnitCompatibility,
  assertLocalManualUserCompatibility,
  assertSafeLocalSeedEnvironment,
  inspectLocalManualSeed,
  LOCAL_MANUAL_SEED,
  readApplyCredentials,
  readSeedEmails,
} from '../../prisma/lib/local-seed/local-manual-seed';
import { MemberStatus, PrismaClient, Role, TenantType, UnitOccupantRole } from '@prisma/client';

describe('local manual seed safety', () => {
  const validEnvironment = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://local:secret@127.0.0.1:5434/buildingos?schema=public',
    LOCAL_SEED_ADMIN_EMAIL: 'admin@buildingos.test',
    LOCAL_SEED_ADMIN_PASSWORD: 'admin-password',
    LOCAL_SEED_RESIDENT_1_EMAIL: 'resident-1@buildingos.test',
    LOCAL_SEED_RESIDENT_1_PASSWORD: 'resident-1-password',
    LOCAL_SEED_RESIDENT_2_EMAIL: 'resident-2@buildingos.test',
    LOCAL_SEED_RESIDENT_2_PASSWORD: 'resident-2-password',
  };

  it('accepts a local buildingos target', () => {
    expect(assertSafeLocalSeedEnvironment(validEnvironment)).toEqual({
      database: 'buildingos',
      host: '127.0.0.1',
    });
  });

  it.each([
    ['development', { ...validEnvironment, NODE_ENV: 'development' }],
    ['test', { ...validEnvironment, NODE_ENV: 'test' }],
    ['empty', { ...validEnvironment, NODE_ENV: undefined }],
  ])('accepts %s as a local runtime env', (_label, environment) => {
    expect(assertSafeLocalSeedEnvironment(environment)).toEqual({
      database: 'buildingos',
      host: '127.0.0.1',
    });
  });

  it.each([
    ['production', { ...validEnvironment, NODE_ENV: 'production' }],
    ['staging', { ...validEnvironment, NODE_ENV: 'staging' }],
    ['remote host', { ...validEnvironment, DATABASE_URL: 'postgresql://local:secret@db.example.com:5432/buildingos' }],
    ['different database', { ...validEnvironment, DATABASE_URL: 'postgresql://local:secret@127.0.0.1:5434/other' }],
    ['staging database', { ...validEnvironment, DATABASE_URL: 'postgresql://local:secret@localhost:5432/buildingos_staging' }],
  ])('rejects %s', (_label, environment) => {
    expect(() => assertSafeLocalSeedEnvironment(environment)).toThrow();
  });

  it('rejects emails outside the @buildingos.test domain', () => {
    expect(() => readSeedEmails({
      ...validEnvironment,
      LOCAL_SEED_ADMIN_EMAIL: 'admin@local.test',
    })).toThrow('must end with @buildingos.test');
  });

  it('rejects missing apply passwords before any connection is attempted', () => {
    expect(() => readApplyCredentials({ ...validEnvironment, LOCAL_SEED_RESIDENT_2_PASSWORD: '' })).toThrow(
      'LOCAL_SEED_RESIDENT_2_PASSWORD is required',
    );
  });

  it('runs diagnostic inspection without exposing a write API', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ database: 'buildingos', user: 'buildingos', address: '127.0.0.1', port: 5432 }]),
      billingPlan: { findUnique: jest.fn().mockResolvedValue(null) },
      tenant: { findUnique: jest.fn().mockResolvedValue(null) },
      user: { count: jest.fn().mockResolvedValue(0) },
    } as unknown as PrismaClient;

    const target = assertSafeLocalSeedEnvironment(validEnvironment);
    const result = await inspectLocalManualSeed(prisma, target, readApplyCredentials(validEnvironment));

    expect(result.existing).toEqual({ plan: 0, tenant: 0, building: 0, units: 0, users: 0 });
    expect((prisma as unknown as { $transaction?: unknown }).$transaction).toBeUndefined();
  });

  it('rejects an incompatible tenant before writes', () => {
    expect(() => assertLocalManualTenantCompatibility({ type: TenantType.EDIFICIO_AUTOGESTION, isDemo: false })).toThrow('incompatible');
  });

  it('rejects an incompatible existing FREE plan before writes', () => {
    expect(() => assertFreePlanCompatibility({
      ...LOCAL_MANUAL_SEED.plan,
      maxUsers: 2,
    })).toThrow('Existing FREE billing plan is incompatible');
  });

  it('rejects a deleted or renamed building', () => {
    expect(() => assertLocalManualBuildingCompatibility({ name: 'Other building', deletedAt: null })).toThrow('incompatible');
    expect(() => assertLocalManualBuildingCompatibility({ name: LOCAL_MANUAL_SEED.buildingName, deletedAt: new Date() })).toThrow('incompatible');
  });

  it('rejects incompatible unit data', () => {
    expect(() => assertLocalManualUnitCompatibility({
      tenantId: 'tenant-1', label: 'different', occupancyStatus: 'VACANT', isBillable: true,
    }, 'tenant-1', LOCAL_MANUAL_SEED.units[0])).toThrow('A-01-01');
  });

  it('rejects an incompatible existing user', () => {
    expect(() => assertLocalManualUserCompatibility(
      { name: 'Other user' },
      { name: 'Administrador Local', email: 'admin@local.test', password: 'password', passwordHash: 'hash', role: Role.TENANT_OWNER },
    )).toThrow('incompatible name');
  });

  it('rejects an incompatible tenant member', () => {
    expect(() => assertLocalManualTenantMemberCompatibility(
      { userId: 'other-user', name: 'Residente Local 1', role: Role.RESIDENT, status: MemberStatus.ACTIVE, disabledAt: null },
      'expected-user',
      { name: 'Residente Local 1', email: 'resident@local.test', password: 'password', passwordHash: 'hash', role: Role.RESIDENT },
    )).toThrow('incompatible');
  });

  it('rejects an inactive or non-primary occupancy', () => {
    expect(() => assertLocalManualOccupancyCompatibility(
      { tenantId: 'tenant-1', role: UnitOccupantRole.RESIDENT, isPrimary: false, endDate: null },
      'tenant-1',
      'resident@local.test',
    )).toThrow('incompatible');
  });
});
