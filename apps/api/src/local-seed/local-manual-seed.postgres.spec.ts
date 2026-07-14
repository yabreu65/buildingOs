import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  applyLocalManualSeed,
  LOCAL_MANUAL_SEED,
  readApplyCredentials,
} from '../../prisma/lib/local-seed/local-manual-seed';

const runIntegration = process.env.RUN_POSTGRES_INTEGRATION === '1';
const describePostgres = runIntegration ? describe : describe.skip;

describePostgres('local manual seed PostgreSQL integration', () => {
  const databaseUrl = process.env.LOCAL_SEED_INTEGRATION_DATABASE_URL;
  const prisma = databaseUrl ? new PrismaClient({ datasources: { db: { url: databaseUrl } } }) : null;
  let createdFreePlan = false;

  beforeAll(async () => {
    if (!prisma) {
      throw new Error('LOCAL_SEED_INTEGRATION_DATABASE_URL is required when RUN_POSTGRES_INTEGRATION=1');
    }
    const database = await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS "database"`;
    if (database[0]?.database === 'buildingos') {
      throw new Error('PostgreSQL integration refuses to run against buildingos');
    }
    const existingPlan = await prisma.billingPlan.findUnique({ where: { planId: 'FREE' } });
    createdFreePlan = !existingPlan;
  });

  beforeEach(async () => {
    if (!prisma) {
      throw new Error('Prisma client was not configured');
    }
    await prisma.tenant.deleteMany({ where: { name: LOCAL_MANUAL_SEED.tenantName } });
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }
    await prisma.tenant.deleteMany({ where: { name: LOCAL_MANUAL_SEED.tenantName } });
    if (createdFreePlan) {
      await prisma.billingPlan.deleteMany({ where: { planId: 'FREE' } });
    }
    await prisma.$disconnect();
  });

  it('is idempotent and leaves finance tables untouched', async () => {
    if (!prisma) {
      throw new Error('Prisma client was not configured');
    }
    const credentials = readApplyCredentials(process.env);
    const target = { database: (await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS "database"`)[0]!.database, host: 'integration-local' };

    const before = await Promise.all([
      prisma.tenant.count(),
      prisma.building.count(),
      prisma.unit.count(),
      prisma.user.count(),
      prisma.membership.count(),
      prisma.tenantMember.count(),
      prisma.unitOccupant.count(),
      prisma.membershipRole.count(),
      prisma.expense.count(),
      prisma.liquidation.count(),
      prisma.charge.count(),
      prisma.payment.count(),
    ]);
    await applyLocalManualSeed(prisma, target, credentials);
    const afterFirst = await Promise.all([
      prisma.tenant.count(),
      prisma.building.count(),
      prisma.unit.count(),
      prisma.user.count(),
      prisma.membership.count(),
      prisma.tenantMember.count(),
      prisma.unitOccupant.count(),
      prisma.membershipRole.count(),
      prisma.expense.count(),
      prisma.liquidation.count(),
      prisma.charge.count(),
      prisma.payment.count(),
    ]);
    await applyLocalManualSeed(prisma, target, credentials);
    const afterSecond = await Promise.all([
      prisma.tenant.count(),
      prisma.building.count(),
      prisma.unit.count(),
      prisma.user.count(),
      prisma.membership.count(),
      prisma.tenantMember.count(),
      prisma.unitOccupant.count(),
      prisma.membershipRole.count(),
      prisma.expense.count(),
      prisma.liquidation.count(),
      prisma.charge.count(),
      prisma.payment.count(),
    ]);
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { name: LOCAL_MANUAL_SEED.tenantName } });
    const building = await prisma.building.findUniqueOrThrow({ where: { tenantId_alias: { tenantId: tenant.id, alias: LOCAL_MANUAL_SEED.buildingAlias } } });
    const vacantUnit = await prisma.unit.findUniqueOrThrow({ where: { buildingId_code: { buildingId: building.id, code: 'A-02-01' } } });
    const [vacantOccupancies, tenantOwnerRoles, residentUsers] = await Promise.all([
      prisma.unitOccupant.count({ where: { tenantId: tenant.id, unitId: vacantUnit.id, endDate: null } }),
      prisma.membershipRole.count({ where: { tenantId: tenant.id, role: 'TENANT_OWNER', scopeType: 'TENANT' } }),
      prisma.user.findMany({
        where: { email: { in: [credentials.resident1, credentials.resident2] } },
        select: { email: true, passwordHash: true },
      }),
    ]);

    expect(afterFirst.slice(0, 8)).toEqual([
      before[0] + 1,
      before[1] + 1,
      before[2] + 3,
      before[3] + 3,
      before[4] + 3,
      before[5] + 3,
      before[6] + 2,
      before[7] + 3,
    ]);
    expect(afterSecond).toEqual(afterFirst);
    expect(afterFirst.slice(8)).toEqual(before.slice(8));
    expect(vacantOccupancies).toBe(0);
    expect(tenantOwnerRoles).toBe(1);
    expect(residentUsers).toHaveLength(2);
    await expect(bcrypt.compare(credentials.resident1Password, residentUsers.find((user) => user.email === credentials.resident1)?.passwordHash ?? '')).resolves.toBe(true);
    await expect(bcrypt.compare(credentials.resident2Password, residentUsers.find((user) => user.email === credentials.resident2)?.passwordHash ?? '')).resolves.toBe(true);
  });

  it('rolls back all seed writes when an existing building is incompatible', async () => {
    if (!prisma) {
      throw new Error('Prisma client was not configured');
    }
    const credentials = readApplyCredentials(process.env);
    const target = {
      database: (await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS "database"`)[0]!.database,
      host: 'integration-local',
    };
    const tenant = await prisma.tenant.create({
      data: { name: LOCAL_MANUAL_SEED.tenantName, type: 'ADMINISTRADORA', isDemo: false },
    });
    await prisma.building.create({
      data: {
        tenantId: tenant.id,
        name: LOCAL_MANUAL_SEED.buildingName,
        alias: LOCAL_MANUAL_SEED.buildingAlias,
        deletedAt: new Date(),
      },
    });
    const before = await Promise.all([
      prisma.billingPlan.count(),
      prisma.subscription.count(),
      prisma.tenant.count(),
      prisma.building.count(),
      prisma.unit.count(),
      prisma.user.count(),
      prisma.membership.count(),
      prisma.tenantMember.count(),
      prisma.unitOccupant.count(),
    ]);

    await expect(applyLocalManualSeed(prisma, target, credentials)).rejects.toThrow('incompatible or deleted');

    const after = await Promise.all([
      prisma.billingPlan.count(),
      prisma.subscription.count(),
      prisma.tenant.count(),
      prisma.building.count(),
      prisma.unit.count(),
      prisma.user.count(),
      prisma.membership.count(),
      prisma.tenantMember.count(),
      prisma.unitOccupant.count(),
    ]);
    expect(after).toEqual(before);
  });
});
