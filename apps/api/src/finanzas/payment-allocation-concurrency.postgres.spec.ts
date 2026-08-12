import { ChargeStatus, PaymentMethod, PaymentStatus, PrismaClient, TenantType } from '@prisma/client';
import {
  createLockedAllocation,
  deleteLockedAllocation,
} from './payment-allocation-transaction';

const ACCEPTANCE_DATABASES = new Set([
  'buildingos_3e3_acceptance',
  'buildingos_3e4_acceptance',
]);
const expectedDatabaseName = process.env.POSTGRES_TEST_DB_NAME;
const fixturePhase = expectedDatabaseName === 'buildingos_3e4_acceptance' ? 'qa3e4' : 'qa3e3';
const enabled =
  process.env.RUN_POSTGRES_INTEGRATION === '1' &&
  expectedDatabaseName !== undefined &&
  ACCEPTANCE_DATABASES.has(expectedDatabaseName);
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
    if (database?.name !== expectedDatabaseName || !ACCEPTANCE_DATABASES.has(database.name)) {
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
      data: { name: `${fixturePhase}-${label}-${suffix}`, type: TenantType.ADMINISTRADORA },
    });
    tenantIds.push(tenant.id);
    const user = await observer.user.create({
      data: {
        email: `${fixturePhase}-${suffix}@buildingos.local`,
        name: `${fixturePhase} concurrency`,
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

  it('downgrades and restores a reconciled cross-currency payment when an allocation is deleted and recreated', async () => {
    const ctx = await fixture('cross-currency-delete-recreate');
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
        status: PaymentStatus.RECONCILED,
        functionalAmountMinor: 365000,
        functionalCurrencyCode: 'VES',
        exchangeRateId: rate.id,
        exchangeRateValue: '36.5',
        exchangeRateDirection: 'DIRECT',
        exchangeRateEffectiveAt: effectiveAt,
        conversionDate: new Date('2026-08-10T00:00:00.000Z'),
      },
    });
    const charges = await Promise.all([
      observer.charge.create({
        data: { ...ctx.chargeData, amount: 100000, currency: 'VES', status: ChargeStatus.PAID },
      }),
      observer.charge.create({
        data: {
          ...ctx.chargeData,
          period: '2026-09',
          concept: 'cross-currency-delete-recreate-2',
          amount: 100000,
          currency: 'VES',
          status: ChargeStatus.PAID,
        },
      }),
      observer.charge.create({
        data: {
          ...ctx.chargeData,
          period: '2026-10',
          concept: 'cross-currency-delete-recreate-3',
          amount: 165000,
          currency: 'VES',
          status: ChargeStatus.PAID,
        },
      }),
    ]);
    const allocations = await Promise.all([
      observer.paymentAllocation.create({
        data: {
          tenantId: ctx.tenant.id,
          paymentId: payment.id,
          chargeId: charges[0].id,
          amount: 100000,
          paymentOriginalAmountMinor: 2740,
        },
      }),
      observer.paymentAllocation.create({
        data: {
          tenantId: ctx.tenant.id,
          paymentId: payment.id,
          chargeId: charges[1].id,
          amount: 100000,
          paymentOriginalAmountMinor: 2740,
        },
      }),
      observer.paymentAllocation.create({
        data: {
          tenantId: ctx.tenant.id,
          paymentId: payment.id,
          chargeId: charges[2].id,
          amount: 165000,
          paymentOriginalAmountMinor: 4520,
        },
      }),
    ]);

    await firstClient.$transaction((tx) => deleteLockedAllocation(
      tx,
      ctx.tenant.id,
      ctx.building.id,
      allocations[2].id,
    ));

    const [downgradedPayment, pendingCharge, remainingTotals] = await Promise.all([
      observer.payment.findUniqueOrThrow({ where: { id: payment.id } }),
      observer.charge.findUniqueOrThrow({ where: { id: charges[2].id } }),
      observer.paymentAllocation.aggregate({
        where: { paymentId: payment.id },
        _sum: { paymentOriginalAmountMinor: true, amount: true },
      }),
    ]);
    expect(downgradedPayment.status).toBe(PaymentStatus.APPROVED);
    expect(pendingCharge.status).toBe(ChargeStatus.PENDING);
    expect(remainingTotals._sum.paymentOriginalAmountMinor).toBe(5480);
    expect(remainingTotals._sum.amount).toBe(200000);

    await firstClient.$transaction((tx) => createLockedAllocation(tx, {
      tenantId: ctx.tenant.id,
      buildingId: ctx.building.id,
      paymentId: payment.id,
      chargeId: charges[2].id,
    }, 165000));

    const [restoredPayment, paidCharge, restoredTotals] = await Promise.all([
      observer.payment.findUniqueOrThrow({ where: { id: payment.id } }),
      observer.charge.findUniqueOrThrow({ where: { id: charges[2].id } }),
      observer.paymentAllocation.aggregate({
        where: { paymentId: payment.id },
        _sum: { paymentOriginalAmountMinor: true, amount: true },
      }),
    ]);
    expect(restoredPayment.status).toBe(PaymentStatus.RECONCILED);
    expect(paidCharge.status).toBe(ChargeStatus.PAID);
    expect(restoredTotals._sum.paymentOriginalAmountMinor).toBe(10000);
    expect(restoredTotals._sum.amount).toBe(365000);
  });

  it('rolls back creation when legacy CROSS consumption has no original share', async () => {
    const ctx = await fixture('legacy-cross-null');
    const effectiveAt = new Date('2026-08-08T00:00:00.000Z');
    const rate = await observer.exchangeRate.create({
      data: {
        tenantId: ctx.tenant.id,
        baseCurrency: 'USD',
        quoteCurrency: 'VES',
        rate: '36.5',
        effectiveAt,
        source: `${fixturePhase} PostgreSQL regression`,
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
    const [legacyCharge, candidateCharge] = await Promise.all([
      observer.charge.create({
        data: { ...ctx.chargeData, amount: 100000, currency: 'VES', status: ChargeStatus.PAID },
      }),
      observer.charge.create({
        data: {
          ...ctx.chargeData,
          period: '2026-09',
          concept: 'legacy-cross-null-candidate',
          amount: 265000,
          currency: 'VES',
        },
      }),
    ]);
    await observer.paymentAllocation.create({
      data: {
        tenantId: ctx.tenant.id,
        paymentId: payment.id,
        chargeId: legacyCharge.id,
        amount: 100000,
        paymentOriginalAmountMinor: null,
      },
    });

    await expect(firstClient.$transaction((tx) => createLockedAllocation(tx, {
      tenantId: ctx.tenant.id,
      buildingId: ctx.building.id,
      paymentId: payment.id,
      chargeId: candidateCharge.id,
    }, 265000))).rejects.toMatchObject({
      response: { statusCode: 422, error: 'PAYMENT_LEGACY_SNAPSHOT_REQUIRED' },
    });

    const [allocations, persistedPayment, persistedCandidateCharge] = await Promise.all([
      observer.paymentAllocation.findMany({ where: { paymentId: payment.id } }),
      observer.payment.findUniqueOrThrow({ where: { id: payment.id } }),
      observer.charge.findUniqueOrThrow({ where: { id: candidateCharge.id } }),
    ]);
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({
      chargeId: legacyCharge.id,
      amount: 100000,
      paymentOriginalAmountMinor: null,
    });
    expect(persistedPayment.status).toBe(PaymentStatus.APPROVED);
    expect(persistedCandidateCharge.status).toBe(ChargeStatus.PENDING);
  });

  it('commits sequential cleanup of two legacy CROSS NULL allocations', async () => {
    const ctx = await fixture('legacy-cross-null-cleanup');
    const effectiveAt = new Date('2026-08-08T00:00:00.000Z');
    const rate = await observer.exchangeRate.create({ data: {
      tenantId: ctx.tenant.id, baseCurrency: 'USD', quoteCurrency: 'VES', rate: '36.5',
      effectiveAt, source: `${fixturePhase} PostgreSQL cleanup`,
    } });
    const payment = await observer.payment.create({ data: {
      ...ctx.paymentData, currency: 'USD', status: PaymentStatus.RECONCILED,
      functionalAmountMinor: 365000, functionalCurrencyCode: 'VES', exchangeRateId: rate.id,
      exchangeRateValue: '36.5', exchangeRateDirection: 'DIRECT', exchangeRateEffectiveAt: effectiveAt,
      conversionDate: new Date('2026-08-10T00:00:00.000Z'),
    } });
    const charges = await Promise.all([100000, 265000].map((amount, index) => observer.charge.create({ data: {
      ...ctx.chargeData, period: `2026-${index + 8}`, concept: `legacy-cleanup-${index}`,
      amount, currency: 'VES', status: ChargeStatus.PAID,
    } })));
    const allocations = await Promise.all(charges.map((charge) => observer.paymentAllocation.create({ data: {
      tenantId: ctx.tenant.id, paymentId: payment.id, chargeId: charge.id,
      amount: charge.amount, paymentOriginalAmountMinor: null,
    } })));

    await firstClient.$transaction((tx) => deleteLockedAllocation(
      tx, ctx.tenant.id, ctx.building.id, allocations[0].id,
    ));
    await expect(observer.paymentAllocation.findMany({ where: { paymentId: payment.id } }))
      .resolves.toEqual([expect.objectContaining({ id: allocations[1].id, paymentOriginalAmountMinor: null })]);
    await expect(observer.payment.findUniqueOrThrow({ where: { id: payment.id } }))
      .resolves.toMatchObject({ status: PaymentStatus.APPROVED });
    await expect(observer.charge.findUniqueOrThrow({ where: { id: charges[0].id } }))
      .resolves.toMatchObject({ status: ChargeStatus.PENDING });

    await firstClient.$transaction((tx) => deleteLockedAllocation(
      tx, ctx.tenant.id, ctx.building.id, allocations[1].id,
    ));
    await expect(observer.paymentAllocation.count({ where: { paymentId: payment.id } })).resolves.toBe(0);
    await expect(observer.payment.findUniqueOrThrow({ where: { id: payment.id } }))
      .resolves.toMatchObject({ status: PaymentStatus.APPROVED });
    await expect(observer.charge.findUniqueOrThrow({ where: { id: charges[1].id } }))
      .resolves.toMatchObject({ status: ChargeStatus.PENDING });
  });

  it('commits progressive mixed cleanup and resumes canonical reconciliation', async () => {
    const ctx = await fixture('mixed-progressive-cleanup');
    const effectiveAt = new Date('2026-08-08T00:00:00.000Z');
    const rate = await observer.exchangeRate.create({ data: {
      tenantId: ctx.tenant.id, baseCurrency: 'USD', quoteCurrency: 'VES', rate: '36.5',
      effectiveAt, source: `${fixturePhase} PostgreSQL mixed cleanup`,
    } });
    const payment = await observer.payment.create({ data: {
      ...ctx.paymentData, currency: 'USD', status: PaymentStatus.RECONCILED,
      functionalAmountMinor: 365000, functionalCurrencyCode: 'VES', exchangeRateId: rate.id,
      exchangeRateValue: '36.5', exchangeRateDirection: 'DIRECT', exchangeRateEffectiveAt: effectiveAt,
      conversionDate: new Date('2026-08-10T00:00:00.000Z'),
    } });
    const definitions = [
      { amount: 4000, currency: 'USD', original: 4000 },
      { amount: 10000, currency: 'USD', original: 10000 },
      { amount: 100000, currency: 'VES', original: null },
      { amount: 265000, currency: 'VES', original: null },
    ];
    const charges = await Promise.all(definitions.map((definition, index) => observer.charge.create({ data: {
      ...ctx.chargeData, period: `2027-0${index + 1}`, concept: `mixed-cleanup-${index}`,
      amount: definition.amount, currency: definition.currency, status: ChargeStatus.PAID,
    } })));
    const allocations = await Promise.all(charges.map((charge, index) => observer.paymentAllocation.create({ data: {
      tenantId: ctx.tenant.id, paymentId: payment.id, chargeId: charge.id,
      amount: charge.amount, paymentOriginalAmountMinor: definitions[index].original,
    } })));

    for (const index of [0, 2]) {
      await firstClient.$transaction((tx) => deleteLockedAllocation(
        tx, ctx.tenant.id, ctx.building.id, allocations[index].id,
      ));
      await expect(observer.payment.findUniqueOrThrow({ where: { id: payment.id } }))
        .resolves.toMatchObject({ status: PaymentStatus.APPROVED });
    }
    await firstClient.$transaction((tx) => deleteLockedAllocation(
      tx, ctx.tenant.id, ctx.building.id, allocations[3].id,
    ));
    await expect(observer.paymentAllocation.findMany({ where: { paymentId: payment.id } }))
      .resolves.toEqual([expect.objectContaining({ id: allocations[1].id, paymentOriginalAmountMinor: 10000 })]);
    await expect(observer.payment.findUniqueOrThrow({ where: { id: payment.id } }))
      .resolves.toMatchObject({ status: PaymentStatus.RECONCILED });
  });

  it('serializes delete with create and returns canonical 404 for a repeated delete', async () => {
    const ctx = await fixture('delete-create-race');
    const payment = await observer.payment.create({ data: ctx.paymentData });
    const charge = await observer.charge.create({ data: ctx.chargeData });
    const allocation = await firstClient.$transaction((tx) => createLockedAllocation(tx, {
      tenantId: ctx.tenant.id, buildingId: ctx.building.id,
      paymentId: payment.id, chargeId: charge.id,
    }, 10000));
    let releaseDelete!: () => void;
    const holdDelete = new Promise<void>((resolve) => { releaseDelete = resolve; });
    let deleted!: () => void;
    const deleteReached = new Promise<void>((resolve) => { deleted = resolve; });
    const first = firstClient.$transaction(async (tx) => {
      await deleteLockedAllocation(tx, ctx.tenant.id, ctx.building.id, allocation.id);
      deleted();
      await holdDelete;
    });
    await deleteReached;
    let secondPid = 0;
    const second = secondClient.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      secondPid = row.pid;
      return createLockedAllocation(tx, {
        tenantId: ctx.tenant.id, buildingId: ctx.building.id,
        paymentId: payment.id, chargeId: charge.id,
      }, 10000);
    });
    while (secondPid === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    await waitUntilBlocked(secondPid);
    releaseDelete();
    await first;
    await expect(second).resolves.toMatchObject({ amount: 10000 });
    await expect(firstClient.$transaction((tx) => deleteLockedAllocation(
      tx, ctx.tenant.id, ctx.building.id, allocation.id,
    ))).rejects.toMatchObject({ status: 404 });
    await expect(observer.payment.findUniqueOrThrow({ where: { id: payment.id } }))
      .resolves.toMatchObject({ status: PaymentStatus.RECONCILED });
  });
});
