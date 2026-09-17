import {
  ChargeStatus,
  PaymentMethod,
  PaymentStatus,
  PrismaClient,
  TenantType,
} from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { buildingStatsIntent } from './building-stats.intent';

const ACCEPTANCE_DATABASE_NAME = 'buildingos_phase3f_r5_acceptance';
const LOCAL_POSTGRES_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const expectedDatabaseName = process.env.POSTGRES_TEST_DB_NAME;
const databaseUrl = process.env.DATABASE_URL;

function hasLoopbackPostgresUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname === '[::1]' ? '::1' : parsed.hostname;
    return (
      (parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:') &&
      LOCAL_POSTGRES_HOSTS.has(hostname)
    );
  } catch {
    return false;
  }
}

const enabled =
  process.env.RUN_POSTGRES_INTEGRATION === '1' &&
  expectedDatabaseName === ACCEPTANCE_DATABASE_NAME &&
  hasLoopbackPostgresUrl(databaseUrl);
const describePostgres = enabled ? describe : describe.skip;

interface CurrencyBucket {
  readonly currency: string;
  readonly amountMinor: number;
}

interface BuildingStatsData {
  readonly totalUnits: number;
  readonly billableUnits: number;
  readonly unitTypeCounts: Record<string, number>;
  readonly occupancyCounts: Record<string, number>;
  readonly openTickets: number;
  readonly totalTickets: number;
  readonly totalDebtByCurrency: CurrencyBucket[];
  readonly averageDebtByCurrency: CurrencyBucket[];
}

interface ChargeInput {
  readonly tenantId: string;
  readonly buildingId: string;
  readonly unitId: string;
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly status?: ChargeStatus;
  readonly canceledAt?: Date;
}

describePostgres('buildingStatsIntent PostgreSQL (Phase 3F-R5)', () => {
  let prisma: PrismaClient;
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  let suffix: string;

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required');
    }

    prisma = new PrismaClient();
    await prisma.$connect();
    const [database] = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT current_database() AS name
    `;
    if (database?.name !== ACCEPTANCE_DATABASE_NAME) {
      throw new Error('Refusing a database outside the Phase 3F-R5 acceptance allowlist');
    }
  });

  beforeEach(() => {
    suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  });

  afterEach(async () => {
    for (const tenantId of tenantIds.splice(0)) {
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    for (const userId of userIds.splice(0)) {
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function createTenantBuilding(label: string) {
    const tenant = await prisma.tenant.create({
      data: {
        id: `r5-tenant-${label}-${suffix}`,
        name: `R5 ${label} ${suffix}`,
        type: TenantType.ADMINISTRADORA,
      },
    });
    tenantIds.push(tenant.id);
    const building = await prisma.building.create({
      data: {
        id: `r5-building-${label}-${suffix}`,
        tenantId: tenant.id,
        name: `R5 Building ${label}`,
        alias: `R5-${label}-${suffix}`,
      },
    });
    return { tenant, building };
  }

  async function createUser(label: string) {
    const user = await prisma.user.create({
      data: {
        id: `r5-user-${label}-${suffix}`,
        email: `r5-${label}-${suffix}@example.test`,
        name: `R5 User ${label}`,
        passwordHash: 'test',
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function createUnit(input: {
    readonly tenantId: string;
    readonly buildingId: string;
    readonly id: string;
    readonly code: string;
    readonly unitType: string;
    readonly occupancyStatus: string;
    readonly isBillable: boolean;
  }) {
    return prisma.unit.create({ data: input });
  }

  async function createCharge(input: ChargeInput) {
    return prisma.charge.create({
      data: {
        id: input.id,
        tenantId: input.tenantId,
        buildingId: input.buildingId,
        unitId: input.unitId,
        period: '2020-01',
        concept: `R5 charge ${input.id}`,
        amount: input.amount,
        currency: input.currency,
        status: input.status,
        canceledAt: input.canceledAt,
        dueDate: new Date('2020-01-01T00:00:00.000Z'),
      },
    });
  }

  async function allocatePayment(input: {
    readonly tenantId: string;
    readonly buildingId: string;
    readonly unitId: string;
    readonly userId: string;
    readonly chargeId: string;
    readonly id: string;
    readonly amount: number;
    readonly currency: string;
    readonly status: PaymentStatus;
    readonly canceledAt?: Date;
  }) {
    const payment = await prisma.payment.create({
      data: {
        id: input.id,
        tenantId: input.tenantId,
        buildingId: input.buildingId,
        unitId: input.unitId,
        amount: input.amount,
        currency: input.currency,
        method: PaymentMethod.TRANSFER,
        status: input.status,
        canceledAt: input.canceledAt,
        createdByUserId: input.userId,
      },
    });
    await prisma.paymentAllocation.create({
      data: {
        id: `${input.id}-allocation`,
        tenantId: input.tenantId,
        paymentId: payment.id,
        chargeId: input.chargeId,
        amount: input.amount,
      },
    });
  }

  function bucketsByCurrency(buckets: readonly CurrencyBucket[]): Record<string, number> {
    return Object.fromEntries(buckets.map((bucket) => [bucket.currency, bucket.amountMinor]));
  }

  it('returns currency-separated final balances from effective allocations within the requested tenant and building', async () => {
    const primary = await createTenantBuilding('primary');
    const otherBuilding = await prisma.building.create({
      data: {
        id: `r5-building-other-${suffix}`,
        tenantId: primary.tenant.id,
        name: 'R5 Other Building',
        alias: `R5-other-${suffix}`,
      },
    });
    const otherTenant = await createTenantBuilding('other-tenant');
    const user = await createUser('primary');
    const apartment = await createUnit({
      id: `r5-unit-apartment-${suffix}`,
      tenantId: primary.tenant.id,
      buildingId: primary.building.id,
      code: 'A-101',
      unitType: 'APARTMENT',
      occupancyStatus: 'OCCUPIED',
      isBillable: true,
    });
    const parking = await createUnit({
      id: `r5-unit-parking-${suffix}`,
      tenantId: primary.tenant.id,
      buildingId: primary.building.id,
      code: 'P-01',
      unitType: 'PARKING',
      occupancyStatus: 'VACANT',
      isBillable: false,
    });
    const otherBuildingUnit = await createUnit({
      id: `r5-unit-other-building-${suffix}`,
      tenantId: primary.tenant.id,
      buildingId: otherBuilding.id,
      code: 'B-101',
      unitType: 'APARTMENT',
      occupancyStatus: 'OCCUPIED',
      isBillable: true,
    });
    const otherTenantUnit = await createUnit({
      id: `r5-unit-other-tenant-${suffix}`,
      tenantId: otherTenant.tenant.id,
      buildingId: otherTenant.building.id,
      code: 'O-101',
      unitType: 'APARTMENT',
      occupancyStatus: 'OCCUPIED',
      isBillable: true,
    });

    const arsChargeId = `r5-charge-ars-${suffix}`;
    const uyuChargeId = `r5-charge-uyu-${suffix}`;
    await Promise.all([
      createCharge({
        id: arsChargeId,
        tenantId: primary.tenant.id,
        buildingId: primary.building.id,
        unitId: apartment.id,
        amount: 1_000,
        currency: 'ARS',
      }),
      createCharge({
        id: uyuChargeId,
        tenantId: primary.tenant.id,
        buildingId: primary.building.id,
        unitId: parking.id,
        amount: 500,
        currency: 'UYU',
      }),
      createCharge({
        id: `r5-charge-canceled-status-${suffix}`,
        tenantId: primary.tenant.id,
        buildingId: primary.building.id,
        unitId: apartment.id,
        amount: 900,
        currency: 'USD',
        status: ChargeStatus.CANCELED,
      }),
      createCharge({
        id: `r5-charge-canceled-soft-${suffix}`,
        tenantId: primary.tenant.id,
        buildingId: primary.building.id,
        unitId: apartment.id,
        amount: 800,
        currency: 'USD',
        canceledAt: new Date('2020-01-02T00:00:00.000Z'),
      }),
      createCharge({
        id: `r5-charge-other-building-${suffix}`,
        tenantId: primary.tenant.id,
        buildingId: otherBuilding.id,
        unitId: otherBuildingUnit.id,
        amount: 700,
        currency: 'USD',
      }),
      createCharge({
        id: `r5-charge-other-tenant-${suffix}`,
        tenantId: otherTenant.tenant.id,
        buildingId: otherTenant.building.id,
        unitId: otherTenantUnit.id,
        amount: 600,
        currency: 'UYU',
      }),
    ]);

    await Promise.all([
      allocatePayment({
        id: `r5-payment-approved-${suffix}`,
        tenantId: primary.tenant.id,
        buildingId: primary.building.id,
        unitId: apartment.id,
        userId: user.id,
        chargeId: arsChargeId,
        amount: 100,
        currency: 'ARS',
        status: PaymentStatus.APPROVED,
      }),
      allocatePayment({
        id: `r5-payment-reconciled-${suffix}`,
        tenantId: primary.tenant.id,
        buildingId: primary.building.id,
        unitId: apartment.id,
        userId: user.id,
        chargeId: arsChargeId,
        amount: 200,
        currency: 'ARS',
        status: PaymentStatus.RECONCILED,
      }),
      allocatePayment({
        id: `r5-payment-submitted-${suffix}`,
        tenantId: primary.tenant.id,
        buildingId: primary.building.id,
        unitId: apartment.id,
        userId: user.id,
        chargeId: arsChargeId,
        amount: 50,
        currency: 'ARS',
        status: PaymentStatus.SUBMITTED,
      }),
      allocatePayment({
        id: `r5-payment-rejected-${suffix}`,
        tenantId: primary.tenant.id,
        buildingId: primary.building.id,
        unitId: apartment.id,
        userId: user.id,
        chargeId: arsChargeId,
        amount: 75,
        currency: 'ARS',
        status: PaymentStatus.REJECTED,
      }),
      allocatePayment({
        id: `r5-payment-soft-canceled-${suffix}`,
        tenantId: primary.tenant.id,
        buildingId: primary.building.id,
        unitId: apartment.id,
        userId: user.id,
        chargeId: arsChargeId,
        amount: 125,
        currency: 'ARS',
        status: PaymentStatus.APPROVED,
        canceledAt: new Date('2020-01-02T00:00:00.000Z'),
      }),
      allocatePayment({
        id: `r5-payment-uyu-approved-${suffix}`,
        tenantId: primary.tenant.id,
        buildingId: primary.building.id,
        unitId: parking.id,
        userId: user.id,
        chargeId: uyuChargeId,
        amount: 100,
        currency: 'UYU',
        status: PaymentStatus.APPROVED,
      }),
    ]);

    const result = await buildingStatsIntent.executor({
      tenantId: primary.tenant.id,
      entityIds: { buildingId: primary.building.id },
      filters: {},
      pagination: { limit: 10 },
      prisma: prisma as unknown as PrismaService,
    });
    const data = result.data as BuildingStatsData;

    expect(data).toMatchObject({
      totalUnits: 2,
      billableUnits: 1,
      unitTypeCounts: { APARTMENT: 1, PARKING: 1 },
      occupancyCounts: { OCCUPIED: 1, VACANT: 1 },
      openTickets: 0,
      totalTickets: 0,
    });
    expect(data.totalDebtByCurrency).toHaveLength(2);
    expect(bucketsByCurrency(data.totalDebtByCurrency)).toEqual({ ARS: 700, UYU: 400 });
    expect(data.averageDebtByCurrency).toHaveLength(2);
    expect(bucketsByCurrency(data.averageDebtByCurrency)).toEqual({ ARS: 350, UYU: 200 });
  });
});
