import {
  PaymentMethod,
  PaymentStatus,
  PrismaClient,
  TenantType,
} from '@prisma/client';
import { InboxService } from './inbox.service';
import type { DelinquentUnit } from './inbox.types';
import type { PrismaService } from '../prisma/prisma.service';

const ACCEPTANCE_DATABASE_NAME = 'buildingos_phase3f_r3_acceptance';
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

type DelinquentUnitsAccessor = {
  getDelinquentUnits(tenantId: string, buildingIds: string[]): Promise<DelinquentUnit[]>;
};

interface ChargeInput {
  readonly tenantId: string;
  readonly buildingId: string;
  readonly unitId: string;
  readonly id: string;
  readonly amount: number;
  readonly currency?: string;
  readonly dueDate?: Date;
  readonly canceledAt?: Date;
}

describePostgres('Inbox delinquency PostgreSQL (Phase 3F-R3)', () => {
  let prisma: PrismaClient;
  let service: InboxService;
  const tenantIds: string[] = [];
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
      throw new Error('Refusing a database outside the Phase 3F-R3 acceptance allowlist');
    }

    service = new InboxService(prisma as unknown as PrismaService);
  });

  beforeEach(() => {
    suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  });

  afterEach(async () => {
    for (const tenantId of tenantIds.splice(0)) {
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function createTenantBuilding(label: string) {
    const tenant = await prisma.tenant.create({
      data: { id: `r3-tenant-${label}-${suffix}`, name: `R3 ${label} ${suffix}`, type: TenantType.ADMINISTRADORA },
    });
    tenantIds.push(tenant.id);
    const building = await prisma.building.create({
      data: {
        id: `r3-building-${label}-${suffix}`,
        tenantId: tenant.id,
        name: `R3 Building ${label}`,
        alias: `R3-${label}-${suffix}`,
      },
    });
    const user = await prisma.user.create({
      data: {
        id: `r3-user-${label}-${suffix}`,
        email: `r3-${label}-${suffix}@example.test`,
        name: `R3 User ${label}`,
        passwordHash: 'test',
      },
    });
    return { tenant, building, user };
  }

  async function createUnit(tenantId: string, buildingId: string, id: string, code: string) {
    return prisma.unit.create({
      data: { id, tenantId, buildingId, code, isBillable: true },
    });
  }

  async function createCharge(input: ChargeInput) {
    return prisma.charge.create({
      data: {
        id: input.id,
        tenantId: input.tenantId,
        buildingId: input.buildingId,
        unitId: input.unitId,
        period: '2020-01',
        concept: `R3 charge ${input.id}`,
        amount: input.amount,
        currency: input.currency ?? 'ARS',
        dueDate: input.dueDate ?? new Date('2020-01-01T00:00:00.000Z'),
        canceledAt: input.canceledAt,
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
        currency: 'ARS',
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

  it('selects the earliest five units before currency grouping, preserves ties by unit ID, and ignores nominal money ranking', async () => {
    const { tenant, building } = await createTenantBuilding('top-five');
    const units = await Promise.all(
      Array.from({ length: 7 }, (_, index) => {
        const sequence = String(index + 1).padStart(2, '0');
        return createUnit(
          tenant.id,
          building.id,
          `r3-unit-${sequence}-${suffix}`,
          `U-${sequence}`,
        );
      }),
    );

    await Promise.all([
      createCharge({ tenantId: tenant.id, buildingId: building.id, unitId: units[0]!.id, id: `r3-c-01-ars-${suffix}`, amount: 200, currency: 'ARS', dueDate: new Date('2020-01-01T00:00:00.000Z') }),
      createCharge({ tenantId: tenant.id, buildingId: building.id, unitId: units[0]!.id, id: `r3-c-01-usd-${suffix}`, amount: 300, currency: 'USD', dueDate: new Date('2020-01-01T00:00:00.000Z') }),
      createCharge({ tenantId: tenant.id, buildingId: building.id, unitId: units[0]!.id, id: `r3-c-01-uyu-${suffix}`, amount: 400, currency: 'UYU', dueDate: new Date('2020-01-01T00:00:00.000Z') }),
      ...units.slice(1).map((unit, index) => createCharge({
        tenantId: tenant.id,
        buildingId: building.id,
        unitId: unit.id,
        id: `r3-c-${String(index + 2).padStart(2, '0')}-${suffix}`,
        amount: index >= 4 ? 99_999_999 : 100,
        dueDate: new Date(`2020-01-0${index + 1}T00:00:00.000Z`),
      })),
    ]);

    const result = await (service as unknown as DelinquentUnitsAccessor).getDelinquentUnits(tenant.id, [building.id]);

    expect(result.map((item) => item.unitId)).toEqual(units.slice(0, 5).map((unit) => unit.id));
    expect(result.map((item) => item.unitId)).not.toContain(units[5]!.id);
    expect(result.map((item) => item.unitId)).not.toContain(units[6]!.id);
    expect(result[0]!.outstandingByCurrency).toEqual([
      { currency: 'USD', amountMinor: 300 },
      { currency: 'ARS', amountMinor: 200 },
      { currency: 'UYU', amountMinor: 400 },
    ]);
  });

  it('keeps a later outstanding charge after older and duplicate paid charges, and ignores rejected allocations', async () => {
    const primary = await createTenantBuilding('balances');
    const otherBuilding = await prisma.building.create({
      data: {
        id: `r3-building-other-${suffix}`,
        tenantId: primary.tenant.id,
        name: 'R3 Other Building',
        alias: `R3-other-${suffix}`,
      },
    });
    const otherTenant = await createTenantBuilding('other-tenant');
    const outstandingUnit = await createUnit(primary.tenant.id, primary.building.id, `r3-outstanding-${suffix}`, 'OUTSTANDING');
    const canceledUnit = await createUnit(primary.tenant.id, primary.building.id, `r3-canceled-${suffix}`, 'CANCELED');
    const otherBuildingUnit = await createUnit(primary.tenant.id, otherBuilding.id, `r3-other-building-unit-${suffix}`, 'OTHER-BUILDING');
    const otherTenantUnit = await createUnit(otherTenant.tenant.id, otherTenant.building.id, `r3-other-tenant-unit-${suffix}`, 'OTHER-TENANT');

    const olderPaidCharge = `r3-older-paid-charge-${suffix}`;
    const outstandingCharge = `r3-outstanding-charge-${suffix}`;
    const duplicatePaidCharge = `r3-duplicate-paid-charge-${suffix}`;
    await Promise.all([
      createCharge({ tenantId: primary.tenant.id, buildingId: primary.building.id, unitId: outstandingUnit.id, id: olderPaidCharge, amount: 100, dueDate: new Date('2020-01-01T00:00:00.000Z') }),
      createCharge({ tenantId: primary.tenant.id, buildingId: primary.building.id, unitId: outstandingUnit.id, id: outstandingCharge, amount: 100, dueDate: new Date('2020-01-02T00:00:00.000Z') }),
      createCharge({ tenantId: primary.tenant.id, buildingId: primary.building.id, unitId: outstandingUnit.id, id: duplicatePaidCharge, amount: 100, dueDate: new Date('2020-01-02T00:00:00.000Z') }),
    ]);
    await Promise.all([
      allocatePayment({ tenantId: primary.tenant.id, buildingId: primary.building.id, unitId: outstandingUnit.id, userId: primary.user.id, chargeId: olderPaidCharge, id: `r3-older-paid-${suffix}`, amount: 100, status: PaymentStatus.APPROVED }),
      allocatePayment({ tenantId: primary.tenant.id, buildingId: primary.building.id, unitId: outstandingUnit.id, userId: primary.user.id, chargeId: outstandingCharge, id: `r3-approved-${suffix}`, amount: 30, status: PaymentStatus.APPROVED }),
      allocatePayment({ tenantId: primary.tenant.id, buildingId: primary.building.id, unitId: outstandingUnit.id, userId: primary.user.id, chargeId: outstandingCharge, id: `r3-reconciled-${suffix}`, amount: 20, status: PaymentStatus.RECONCILED }),
      allocatePayment({ tenantId: primary.tenant.id, buildingId: primary.building.id, unitId: outstandingUnit.id, userId: primary.user.id, chargeId: outstandingCharge, id: `r3-rejected-${suffix}`, amount: 10, status: PaymentStatus.REJECTED }),
      allocatePayment({ tenantId: primary.tenant.id, buildingId: primary.building.id, unitId: outstandingUnit.id, userId: primary.user.id, chargeId: outstandingCharge, id: `r3-canceled-payment-${suffix}`, amount: 15, status: PaymentStatus.APPROVED, canceledAt: new Date('2020-01-02T00:00:00.000Z') }),
      allocatePayment({ tenantId: primary.tenant.id, buildingId: primary.building.id, unitId: outstandingUnit.id, userId: primary.user.id, chargeId: duplicatePaidCharge, id: `r3-duplicate-paid-${suffix}`, amount: 100, status: PaymentStatus.APPROVED }),
    ]);

    await createCharge({ tenantId: primary.tenant.id, buildingId: primary.building.id, unitId: canceledUnit.id, id: `r3-canceled-charge-${suffix}`, amount: 80, canceledAt: new Date('2020-01-02T00:00:00.000Z') });
    await createCharge({ tenantId: primary.tenant.id, buildingId: otherBuilding.id, unitId: otherBuildingUnit.id, id: `r3-other-building-charge-${suffix}`, amount: 90 });
    await createCharge({ tenantId: otherTenant.tenant.id, buildingId: otherTenant.building.id, unitId: otherTenantUnit.id, id: `r3-other-tenant-charge-${suffix}`, amount: 100 });

    const result = await (service as unknown as DelinquentUnitsAccessor).getDelinquentUnits(primary.tenant.id, [primary.building.id]);

    expect(result).toEqual([{
      buildingId: primary.building.id,
      buildingName: primary.building.name,
      unitId: outstandingUnit.id,
      unitCode: 'OUTSTANDING',
      outstandingByCurrency: [{ currency: 'ARS', amountMinor: 50 }],
    }]);
  });
});
