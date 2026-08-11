import { ChargeStatus, PaymentMethod, PaymentStatus, PrismaClient, TenantType } from '@prisma/client';
import { createLockedAllocation } from './payment-allocation-transaction';

const enabled =
  process.env.RUN_POSTGRES_INTEGRATION === '1' &&
  process.env.POSTGRES_TEST_DB_NAME === 'buildingos_3e3_acceptance';
const describePostgres = enabled ? describe : describe.skip;

describePostgres('Payment allocation PostgreSQL concurrency', () => {
  let observer: PrismaClient;
  let firstClient: PrismaClient;
  let secondClient: PrismaClient;
  const tenantIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    observer = new PrismaClient();
    firstClient = new PrismaClient();
    secondClient = new PrismaClient();
    await Promise.all([observer.$connect(), firstClient.$connect(), secondClient.$connect()]);
    const [database] = await observer.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (database?.name !== 'buildingos_3e3_acceptance') {
      throw new Error(`Refusing destructive test database ${database?.name ?? 'unknown'}`);
    }
  });

  afterEach(async () => {
    for (const tenantId of tenantIds.splice(0)) {
      await observer.tenant.delete({ where: { id: tenantId } });
    }
    for (const userId of userIds.splice(0)) {
      await observer.user.delete({ where: { id: userId } });
    }
  });

  afterAll(async () => {
    await Promise.all([
      observer?.$disconnect(),
      firstClient?.$disconnect(),
      secondClient?.$disconnect(),
    ]);
  });

  async function fixture(label: string) {
    const suffix = `${Date.now()}-${Math.random()}`;
    const tenant = await observer.tenant.create({
      data: { name: `3E3 ${label} ${suffix}`, type: TenantType.ADMINISTRADORA },
    });
    tenantIds.push(tenant.id);
    const user = await observer.user.create({
      data: {
        email: `3e3-${suffix}@buildingos.local`,
        name: '3E3 concurrency',
        passwordHash: 'test',
      },
    });
    userIds.push(user.id);
    const building = await observer.building.create({
      data: { tenantId: tenant.id, name: `Building ${suffix}`, alias: `B-${suffix}`, address: 'Test' },
    });
    const unit = await observer.unit.create({
      data: {
        tenantId: tenant.id,
        buildingId: building.id,
        code: '1',
        label: '1',
        unitType: 'APARTAMENTO',
        occupancyStatus: 'OCCUPIED',
        isBillable: true,
      },
    });
    const paymentData = {
      tenantId: tenant.id,
      buildingId: building.id,
      unitId: unit.id,
      amount: 10000,
      currency: 'ARS',
      method: PaymentMethod.TRANSFER,
      status: PaymentStatus.APPROVED,
      createdByUserId: user.id,
    } as const;
    const chargeData = {
      tenantId: tenant.id,
      buildingId: building.id,
      unitId: unit.id,
      period: '2026-08',
      concept: label,
      amount: 10000,
      currency: 'ARS',
      dueDate: new Date('2026-08-31T00:00:00.000Z'),
    } as const;
    return { tenant, building, paymentData, chargeData };
  }

  async function waitUntilBlocked(pid: number): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [activity] = await observer.$queryRaw<Array<{ wait_event_type: string | null }>>`
        SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}
      `;
      if (activity?.wait_event_type === 'Lock') return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Backend ${pid} did not reach a database lock wait`);
  }

  it('serializes two 7000 allocations against one 10000 payment', async () => {
    const ctx = await fixture('payment-race');
    const payment = await observer.payment.create({ data: ctx.paymentData });
    const firstCharge = await observer.charge.create({ data: ctx.chargeData });
    const secondCharge = await observer.charge.create({
      data: { ...ctx.chargeData, period: '2026-09', concept: 'payment-race-2' },
    });
    let releaseFirst!: () => void;
    const holdFirst = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstInserted!: () => void;
    const inserted = new Promise<void>((resolve) => { firstInserted = resolve; });

    const first = firstClient.$transaction(async (tx) => {
      await createLockedAllocation(tx, {
        tenantId: ctx.tenant.id, buildingId: ctx.building.id,
        paymentId: payment.id, chargeId: firstCharge.id,
      }, 7000);
      firstInserted();
      await holdFirst;
    });
    await inserted;
    let secondPid = 0;
    const second = secondClient.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      secondPid = row.pid;
      await createLockedAllocation(tx, {
        tenantId: ctx.tenant.id, buildingId: ctx.building.id,
        paymentId: payment.id, chargeId: secondCharge.id,
      }, 7000);
    });
    while (secondPid === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    await waitUntilBlocked(secondPid);
    releaseFirst();
    await first;
    await expect(second).rejects.toMatchObject({ response: { error: 'PAYMENT_ORIGINAL_AMOUNT_EXCEEDED' } });
    const total = await observer.paymentAllocation.aggregate({
      where: { paymentId: payment.id }, _sum: { paymentOriginalAmountMinor: true },
    });
    expect(total._sum.paymentOriginalAmountMinor).toBe(7000);
  });

  it('serializes two 7000 payments against one 10000 charge', async () => {
    const ctx = await fixture('charge-race');
    const [firstPayment, secondPayment] = await Promise.all([
      observer.payment.create({ data: ctx.paymentData }),
      observer.payment.create({ data: { ...ctx.paymentData, reference: 'second' } }),
    ]);
    const charge = await observer.charge.create({ data: ctx.chargeData });
    let releaseFirst!: () => void;
    const holdFirst = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstInserted!: () => void;
    const inserted = new Promise<void>((resolve) => { firstInserted = resolve; });
    const first = firstClient.$transaction(async (tx) => {
      await createLockedAllocation(tx, {
        tenantId: ctx.tenant.id, buildingId: ctx.building.id,
        paymentId: firstPayment.id, chargeId: charge.id,
      }, 7000);
      firstInserted();
      await holdFirst;
    });
    await inserted;
    let secondPid = 0;
    const second = secondClient.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      secondPid = row.pid;
      await createLockedAllocation(tx, {
        tenantId: ctx.tenant.id, buildingId: ctx.building.id,
        paymentId: secondPayment.id, chargeId: charge.id,
      }, 7000);
    });
    while (secondPid === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    await waitUntilBlocked(secondPid);
    releaseFirst();
    await first;
    await expect(second).rejects.toThrow('charge available outstanding');
    const total = await observer.paymentAllocation.aggregate({
      where: { chargeId: charge.id }, _sum: { amount: true },
    });
    expect(total._sum.amount).toBe(7000);
  });

  it('reconciles a same-currency allocation despite a complete cross-currency snapshot', async () => {
    const ctx = await fixture('same-currency-complete-snapshot');
    const effectiveAt = new Date('2026-08-08T00:00:00.000Z');
    const rate = await observer.exchangeRate.create({
      data: {
        tenantId: ctx.tenant.id,
        baseCurrency: 'USD',
        quoteCurrency: 'VES',
        rate: '36.5',
        effectiveAt,
        source: '3E3 PostgreSQL regression',
      },
    });
    const payment = await observer.payment.create({
      data: {
        ...ctx.paymentData,
        currency: 'USD',
        functionalAmountMinor: 365000,
        functionalCurrencyCode: 'VES',
        exchangeRateId: rate.id,
        exchangeRateValue: '36.5',
        exchangeRateDirection: 'DIRECT',
        exchangeRateEffectiveAt: effectiveAt,
        conversionDate: new Date('2026-08-10T00:00:00.000Z'),
      },
    });
    const charge = await observer.charge.create({
      data: { ...ctx.chargeData, currency: 'USD' },
    });

    await firstClient.$transaction((tx) => createLockedAllocation(tx, {
      tenantId: ctx.tenant.id,
      buildingId: ctx.building.id,
      paymentId: payment.id,
      chargeId: charge.id,
    }, 10000));

    const [allocation, persistedCharge, persistedPayment] = await Promise.all([
      observer.paymentAllocation.findUniqueOrThrow({
        where: { paymentId_chargeId: { paymentId: payment.id, chargeId: charge.id } },
      }),
      observer.charge.findUniqueOrThrow({ where: { id: charge.id } }),
      observer.payment.findUniqueOrThrow({ where: { id: payment.id } }),
    ]);
    expect(allocation.amount).toBe(10000);
    expect(allocation.paymentOriginalAmountMinor).toBe(10000);
    expect(persistedCharge.status).toBe(ChargeStatus.PAID);
    expect(persistedPayment.status).toBe(PaymentStatus.RECONCILED);
  });
});
