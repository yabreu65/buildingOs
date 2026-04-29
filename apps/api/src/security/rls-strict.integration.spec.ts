import { PrismaClient, TenantType } from '@prisma/client';

const hasDb = Boolean(process.env.DATABASE_URL);
const runIntegration = process.env.RUN_RLS_INTEGRATION === 'true';
const describeIf = hasDb && runIntegration ? describe : describe.skip;

describeIf('RLS strict mode integration', () => {
  const prisma = new PrismaClient();
  const rlsQueryRole = 'rls_app_test';
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const titlePrefix = `RLS_E2E_${suffix}`;

  let tenantAId = '';
  let tenantBId = '';
  let userAId = '';
  let userBId = '';

  beforeAll(async () => {
    await prisma.$connect();

    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${rlsQueryRole}') THEN
          CREATE ROLE ${rlsQueryRole} NOLOGIN NOBYPASSRLS;
        END IF;
      END
      $$;
    `);

    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${rlsQueryRole};`);
    await prisma.$executeRawUnsafe(`GRANT SELECT ON TABLE "Ticket" TO ${rlsQueryRole};`);

    const [tenantA, tenantB, userA, userB] = await Promise.all([
      prisma.tenant.create({
        data: {
          name: `rls-tenant-a-${suffix}`,
          type: TenantType.ADMINISTRADORA,
        },
      }),
      prisma.tenant.create({
        data: {
          name: `rls-tenant-b-${suffix}`,
          type: TenantType.ADMINISTRADORA,
        },
      }),
      prisma.user.create({
        data: {
          email: `rls-user-a-${suffix}@example.com`,
          name: 'RLS User A',
          passwordHash: 'hash',
        },
      }),
      prisma.user.create({
        data: {
          email: `rls-user-b-${suffix}@example.com`,
          name: 'RLS User B',
          passwordHash: 'hash',
        },
      }),
    ]);

    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
    userAId = userA.id;
    userBId = userB.id;

    const buildingA = await prisma.building.create({
      data: {
        tenantId: tenantAId,
        name: `RLS Building A ${suffix}`,
      },
    });

    const buildingB = await prisma.building.create({
      data: {
        tenantId: tenantBId,
        name: `RLS Building B ${suffix}`,
      },
    });

    await Promise.all([
      prisma.ticket.create({
        data: {
          tenantId: tenantAId,
          buildingId: buildingA.id,
          createdByUserId: userAId,
          title: `${titlePrefix}_A`,
          description: 'Ticket tenant A',
        },
      }),
      prisma.ticket.create({
        data: {
          tenantId: tenantBId,
          buildingId: buildingB.id,
          createdByUserId: userBId,
          title: `${titlePrefix}_B`,
          description: 'Ticket tenant B',
        },
      }),
    ]);
  });

  afterAll(async () => {
    if (tenantAId) {
      await prisma.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
    }

    if (userAId) {
      await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    }

    await prisma.$disconnect();
  });

  async function countTicketsWithSessionConfig(options: {
    mode: 'permissive' | 'strict';
    tenantId?: string;
  }): Promise<number> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_mode', ${options.mode}, true)`;
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${options.tenantId ?? ''}, true)`;
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${rlsQueryRole};`);

      const rows = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count
        FROM "Ticket"
        WHERE "title" LIKE ${`${titlePrefix}%`}
      `;

      return Number(rows[0]?.count ?? 0n);
    });
  }

  it('returns both tenant rows in permissive mode without tenant context', async () => {
    const count = await countTicketsWithSessionConfig({ mode: 'permissive' });
    expect(count).toBe(2);
  });

  it('blocks rows in strict mode without tenant context', async () => {
    const count = await countTicketsWithSessionConfig({ mode: 'strict' });
    expect(count).toBe(0);
  });

  it('returns only tenant-scoped rows in strict mode with tenant context', async () => {
    const countA = await countTicketsWithSessionConfig({
      mode: 'strict',
      tenantId: tenantAId,
    });
    const countB = await countTicketsWithSessionConfig({
      mode: 'strict',
      tenantId: tenantBId,
    });

    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });
});
