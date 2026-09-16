import {
  MemberStatus,
  PrismaClient,
  TenantType,
  UnitOccupantRole,
} from '@prisma/client';
import { FinanzasService } from './finanzas.service';
import {
  BuildingDelinquencyAging,
  BuildingDelinquencySortBy,
  BuildingDelinquencySortOrder,
} from './finanzas.dto';
import { FinanzasValidators } from './finanzas.validators';
import { PrismaService } from '../prisma/prisma.service';

const ACCEPTANCE_DATABASE_NAME = 'buildingos_phase3f_r2_acceptance';
const LOCAL_POSTGRES_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const expectedDatabaseName = process.env.POSTGRES_TEST_DB_NAME;
const databaseUrl = process.env.DATABASE_URL;

function hasLocalPostgresUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const { hostname } = new URL(url);
    const normalizedHostname = hostname === '[::1]' ? '::1' : hostname;
    return LOCAL_POSTGRES_HOSTS.has(normalizedHostname);
  } catch {
    return false;
  }
}

const enabled =
  process.env.RUN_POSTGRES_INTEGRATION === '1' &&
  expectedDatabaseName === ACCEPTANCE_DATABASE_NAME &&
  hasLocalPostgresUrl(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;

describePostgres('Finanzas delinquency PostgreSQL (Phase 3F-R2)', () => {
  let prisma: PrismaClient;
  let service: FinanzasService;
  const tenantIds: string[] = [];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required');
    }

    prisma = new PrismaClient();
    await prisma.$connect();
    const [database] = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT current_database() AS name
    `;
    if (database?.name !== ACCEPTANCE_DATABASE_NAME) {
      throw new Error('Refusing a database outside the acceptance allowlist');
    }

    service = new FinanzasService(
      prisma as unknown as PrismaService,
      {
        validateBuildingBelongsToTenant: async () => undefined,
      } as unknown as FinanzasValidators,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  afterEach(async () => {
    for (const tenantId of tenantIds.splice(0)) {
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function fixture() {
    const suffix = `${Date.now()}-${Math.random()}`;
    const tenant = await prisma.tenant.create({
      data: {
        name: `phase3f-r2-${suffix}`,
        type: TenantType.ADMINISTRADORA,
      },
    });
    tenantIds.push(tenant.id);
    const building = await prisma.building.create({
      data: {
        tenantId: tenant.id,
        name: `Building ${suffix}`,
        alias: `B-${suffix}`,
        address: 'Test',
      },
    });
    const responsible = await prisma.tenantMember.create({
      data: {
        tenantId: tenant.id,
        name: 'Ada Lovelace',
        status: MemberStatus.ACTIVE,
      },
    });
    const [historicalCurrencyUnit, samePeriodMultiCurrencyUnit, usdUnit, copUnit, uyuUnit, threePeriodUnit, fourPeriodUnit] = await Promise.all([
      prisma.unit.create({
        data: {
          tenantId: tenant.id,
          buildingId: building.id,
          code: 'A-01',
          label: 'Alpha Historical',
          unitType: 'APARTAMENTO',
          occupancyStatus: 'OCCUPIED',
          isBillable: true,
        },
      }),
      prisma.unit.create({
        data: {
          tenantId: tenant.id,
          buildingId: building.id,
          code: 'B-01',
          label: 'Bravo Same Period',
          unitType: 'APARTAMENTO',
          occupancyStatus: 'OCCUPIED',
          isBillable: true,
        },
      }),
      prisma.unit.create({
        data: {
          tenantId: tenant.id,
          buildingId: building.id,
          code: 'C-01',
          label: 'Charlie USD',
          unitType: 'APARTAMENTO',
          occupancyStatus: 'OCCUPIED',
          isBillable: true,
        },
      }),
      prisma.unit.create({
        data: {
          tenantId: tenant.id,
          buildingId: building.id,
          code: 'D-01',
          label: 'Delta COP',
          unitType: 'APARTAMENTO',
          occupancyStatus: 'OCCUPIED',
          isBillable: true,
        },
      }),
      prisma.unit.create({
        data: {
          tenantId: tenant.id,
          buildingId: building.id,
          code: 'E-01',
          label: 'Echo UYU',
          unitType: 'APARTAMENTO',
          occupancyStatus: 'OCCUPIED',
          isBillable: true,
        },
      }),
      prisma.unit.create({
        data: {
          tenantId: tenant.id,
          buildingId: building.id,
          code: 'F-01',
          label: 'Foxtrot Three Periods',
          unitType: 'APARTAMENTO',
          occupancyStatus: 'OCCUPIED',
          isBillable: true,
        },
      }),
      prisma.unit.create({
        data: {
          tenantId: tenant.id,
          buildingId: building.id,
          code: 'G-01',
          label: 'Golf Four Periods',
          unitType: 'APARTAMENTO',
          occupancyStatus: 'OCCUPIED',
          isBillable: true,
        },
      }),
    ]);

    await prisma.unitOccupant.create({
      data: {
        tenantId: tenant.id,
        unitId: historicalCurrencyUnit.id,
        memberId: responsible.id,
        role: UnitOccupantRole.RESIDENT,
        isPrimary: true,
      },
    });

    const dueDate = new Date('2026-07-31T00:00:00.000Z');
    await prisma.charge.createMany({
      data: [
        {
          tenantId: tenant.id,
          buildingId: building.id,
          unitId: historicalCurrencyUnit.id,
          period: '2026-06',
          concept: 'Historical USD',
          amount: 125,
          currency: 'USD',
          dueDate,
        },
        {
          tenantId: tenant.id,
          buildingId: building.id,
          unitId: historicalCurrencyUnit.id,
          period: '2026-07',
          concept: 'Current ARS',
          amount: 90,
          currency: 'ARS',
          dueDate,
        },
        {
          tenantId: tenant.id,
          buildingId: building.id,
          unitId: samePeriodMultiCurrencyUnit.id,
          period: '2026-07',
          concept: 'Current USD',
          amount: 50,
          currency: 'USD',
          dueDate,
        },
        {
          tenantId: tenant.id,
          buildingId: building.id,
          unitId: samePeriodMultiCurrencyUnit.id,
          period: '2026-07',
          concept: 'Current COP',
          amount: 75,
          currency: 'COP',
          dueDate,
        },
        {
          tenantId: tenant.id,
          buildingId: building.id,
          unitId: usdUnit.id,
          period: '2026-07',
          concept: 'Current USD',
          amount: 300,
          currency: 'USD',
          dueDate,
        },
        {
          tenantId: tenant.id,
          buildingId: building.id,
          unitId: copUnit.id,
          period: '2026-07',
          concept: 'Current COP',
          amount: 400,
          currency: 'COP',
          dueDate,
        },
        {
          tenantId: tenant.id,
          buildingId: building.id,
          unitId: uyuUnit.id,
          period: '2026-07',
          concept: 'Current legacy UYU',
          amount: 500,
          currency: 'UYU',
          dueDate,
        },
        ...['2026-05', '2026-06', '2026-07'].map((period) => ({
          tenantId: tenant.id,
          buildingId: building.id,
          unitId: threePeriodUnit.id,
          period,
          concept: `Three periods ${period}`,
          amount: 25,
          currency: 'ARS',
          dueDate,
        })),
        ...['2026-04', '2026-05', '2026-06', '2026-07'].map((period) => ({
          tenantId: tenant.id,
          buildingId: building.id,
          unitId: fourPeriodUnit.id,
          period,
          concept: `Four periods ${period}`,
          amount: 25,
          currency: 'ARS',
          dueDate,
        })),
      ],
    });

    return {
      tenant,
      building,
      historicalCurrencyUnit,
      samePeriodMultiCurrencyUnit,
      usdUnit,
      copUnit,
      uyuUnit,
      threePeriodUnit,
      fourPeriodUnit,
    };
  }

  it('counts cross-period debt exactly by distinct periods and retains old-currency accumulated buckets', async () => {
    const ctx = await fixture();

    const result = await service.getBuildingDelinquency(
      ctx.tenant.id,
      ctx.building.id,
      { period: '2026-07' },
    );

    expect(result.total).toBe(7);
    expect(result.items.map(({ unitId }) => unitId)).toEqual([
      ctx.fourPeriodUnit.id,
      ctx.threePeriodUnit.id,
      ctx.historicalCurrencyUnit.id,
      ctx.samePeriodMultiCurrencyUnit.id,
      ctx.usdUnit.id,
      ctx.copUnit.id,
      ctx.uyuUnit.id,
    ]);
    expect(result.items.map(({ unitId, overduePeriods }) => ({ unitId, overduePeriods }))).toEqual([
      { unitId: ctx.fourPeriodUnit.id, overduePeriods: 4 },
      { unitId: ctx.threePeriodUnit.id, overduePeriods: 3 },
      { unitId: ctx.historicalCurrencyUnit.id, overduePeriods: 2 },
      { unitId: ctx.samePeriodMultiCurrencyUnit.id, overduePeriods: 1 },
      { unitId: ctx.usdUnit.id, overduePeriods: 1 },
      { unitId: ctx.copUnit.id, overduePeriods: 1 },
      { unitId: ctx.uyuUnit.id, overduePeriods: 1 },
    ]);
    expect(result.items.find(({ unitId }) => unitId === ctx.samePeriodMultiCurrencyUnit.id)).toMatchObject({
      overduePeriods: 1,
      periodDebtByCurrency: [
        { currency: 'COP', amountMinor: 75 },
        { currency: 'USD', amountMinor: 50 },
      ],
    });
    expect(result.items.find(({ unitId }) => unitId === ctx.historicalCurrencyUnit.id)).toMatchObject({
      responsibleName: 'Ada Lovelace',
      periodDebtByCurrency: [{ currency: 'ARS', amountMinor: 90 }],
      accumulatedDebtByCurrency: [
        { currency: 'ARS', amountMinor: 90 },
        { currency: 'USD', amountMinor: 125 },
      ],
    });
  });

  it.each([
    {
      currency: 'USD',
      expectedUnitIds: (ctx: Awaited<ReturnType<typeof fixture>>) => [
        ctx.usdUnit.id,
        ctx.historicalCurrencyUnit.id,
        ctx.samePeriodMultiCurrencyUnit.id,
        ctx.copUnit.id,
        ctx.uyuUnit.id,
        ctx.threePeriodUnit.id,
        ctx.fourPeriodUnit.id,
      ],
    },
    {
      currency: 'COP',
      expectedUnitIds: (ctx: Awaited<ReturnType<typeof fixture>>) => [
        ctx.copUnit.id,
        ctx.samePeriodMultiCurrencyUnit.id,
        ctx.historicalCurrencyUnit.id,
        ctx.usdUnit.id,
        ctx.uyuUnit.id,
        ctx.threePeriodUnit.id,
        ctx.fourPeriodUnit.id,
      ],
    },
    {
      currency: 'UYU',
      expectedUnitIds: (ctx: Awaited<ReturnType<typeof fixture>>) => [
        ctx.uyuUnit.id,
        ctx.historicalCurrencyUnit.id,
        ctx.samePeriodMultiCurrencyUnit.id,
        ctx.usdUnit.id,
        ctx.copUnit.id,
        ctx.threePeriodUnit.id,
        ctx.fourPeriodUnit.id,
      ],
    },
  ])('sorts accumulated debt by explicit $currency currency', async ({ currency, expectedUnitIds }) => {
    const ctx = await fixture();

    const result = await service.getBuildingDelinquency(
      ctx.tenant.id,
      ctx.building.id,
      {
        period: '2026-07',
        currency,
        sortBy: BuildingDelinquencySortBy.ACCUMULATED_DEBT,
        sortOrder: BuildingDelinquencySortOrder.DESC,
      },
    );

    expect(result.items.map(({ unitId }) => unitId)).toEqual(expectedUnitIds(ctx));
  });

  it('searches unit code, label, and responsible name', async () => {
    const ctx = await fixture();

    for (const search of ['A-01', 'Historical', 'Ada Lovelace']) {
      const result = await service.getBuildingDelinquency(
        ctx.tenant.id,
        ctx.building.id,
        { period: '2026-07', search },
      );

      expect(result.total).toBe(1);
      expect(result.items.map(({ unitId }) => unitId)).toEqual([
        ctx.historicalCurrencyUnit.id,
      ]);
    }
  });

  it.each([
    {
      aging: BuildingDelinquencyAging.ALL,
      expectedUnitIds: (ctx: Awaited<ReturnType<typeof fixture>>) => [
        ctx.fourPeriodUnit.id,
        ctx.threePeriodUnit.id,
        ctx.historicalCurrencyUnit.id,
        ctx.samePeriodMultiCurrencyUnit.id,
        ctx.usdUnit.id,
        ctx.copUnit.id,
        ctx.uyuUnit.id,
      ],
    },
    {
      aging: BuildingDelinquencyAging.ONE_PERIOD,
      expectedUnitIds: (ctx: Awaited<ReturnType<typeof fixture>>) => [
        ctx.samePeriodMultiCurrencyUnit.id,
        ctx.usdUnit.id,
        ctx.copUnit.id,
        ctx.uyuUnit.id,
      ],
    },
    {
      aging: BuildingDelinquencyAging.TWO_TO_THREE_PERIODS,
      expectedUnitIds: (ctx: Awaited<ReturnType<typeof fixture>>) => [
        ctx.threePeriodUnit.id,
        ctx.historicalCurrencyUnit.id,
      ],
    },
    {
      aging: BuildingDelinquencyAging.MORE_THAN_THREE_PERIODS,
      expectedUnitIds: (ctx: Awaited<ReturnType<typeof fixture>>) => [
        ctx.fourPeriodUnit.id,
      ],
    },
  ])('filters the $aging aging range', async ({ aging, expectedUnitIds }) => {
    const ctx = await fixture();

    const result = await service.getBuildingDelinquency(
      ctx.tenant.id,
      ctx.building.id,
      { period: '2026-07', aging },
    );

    expect(result.items.map(({ unitId }) => unitId)).toEqual(expectedUnitIds(ctx));
  });

  it('combines search and aging filters', async () => {
    const ctx = await fixture();

    const result = await service.getBuildingDelinquency(
      ctx.tenant.id,
      ctx.building.id,
      {
        period: '2026-07',
        search: 'Ada',
        aging: BuildingDelinquencyAging.TWO_TO_THREE_PERIODS,
      },
    );

    expect(result.total).toBe(1);
    expect(result.items.map(({ unitId }) => unitId)).toEqual([
      ctx.historicalCurrencyUnit.id,
    ]);
  });
});
