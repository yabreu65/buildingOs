import { Prisma, PrismaClient, TenantType } from '@prisma/client';
import { CurrencyConversionService } from './currency-conversion.service';
import { acquireExchangeRateLock, acquireExchangeRatePairLock } from './exchange-rate-locks';
import { MulticurrencyService } from './multicurrency.service';
import type { PrismaService } from '../prisma/prisma.service';

const ACCEPTANCE_DATABASES = new Set(['buildingos_fin02_acceptance', 'buildingos_local_v2_test']);
const expectedDatabaseName = process.env.POSTGRES_TEST_DB_NAME;
const enabled =
  process.env.RUN_POSTGRES_INTEGRATION === '1' &&
  expectedDatabaseName !== undefined &&
  ACCEPTANCE_DATABASES.has(expectedDatabaseName);
const describePostgres = enabled ? describe : describe.skip;

describePostgres('ExchangeRate snapshot immutability PostgreSQL concurrency', () => {
  let observer: PrismaClient;
  let firstClient: PrismaClient;
  let secondClient: PrismaClient;
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  const membershipIds: string[] = [];

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
    const tenants = tenantIds.splice(0);
    const memberships = membershipIds.splice(0);
    const users = userIds.splice(0);
    if (tenants.length > 0) await observer.tenant.deleteMany({ where: { id: { in: tenants } } });
    if (memberships.length > 0) await observer.membership.deleteMany({ where: { id: { in: memberships } } });
    if (users.length > 0) await observer.user.deleteMany({ where: { id: { in: users } } });
  });

  afterAll(async () => {
    await Promise.all([
      observer?.$disconnect(),
      firstClient?.$disconnect(),
      secondClient?.$disconnect(),
    ]);
  });

  async function fixture(label: string) {
    const suffix = `${label}-${Date.now()}-${Math.random()}`;
    const tenant = await observer.tenant.create({
      data: { name: `fx-${suffix}`, type: TenantType.ADMINISTRADORA, functionalCurrency: 'VES' },
    });
    tenantIds.push(tenant.id);
    const user = await observer.user.create({
      data: { email: `fx-${suffix}@buildingos.local`, name: 'FX concurrency', passwordHash: 'test' },
    });
    userIds.push(user.id);
    const membership = await observer.membership.create({
      data: { tenantId: tenant.id, userId: user.id },
    });
    membershipIds.push(membership.id);
    const building = await observer.building.create({
      data: { tenantId: tenant.id, name: `Building ${suffix}`, alias: `B-${suffix}` },
    });
    const category = await observer.expenseLedgerCategory.create({
      data: { tenantId: tenant.id, name: `Category ${suffix}`, movementType: 'EXPENSE' },
    });
    const rate = await observer.exchangeRate.create({
      data: {
        tenantId: tenant.id,
        baseCurrency: 'USD',
        quoteCurrency: 'VES',
        rate: new Prisma.Decimal('36.5'),
        effectiveAt: new Date('2026-08-09T00:00:00.000Z'),
        createdByMembershipId: membership.id,
      },
    });
    return { tenant, user, membership, building, category, rate };
  }

  async function backendPid(tx: Prisma.TransactionClient): Promise<number> {
    const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    return row.pid;
  }

  function deferredPid(): { readonly promise: Promise<number>; readonly resolve: (pid: number) => void } {
    let resolvePid!: (pid: number) => void;
    const promise = new Promise<number>((resolve) => { resolvePid = resolve; });
    return { promise, resolve: resolvePid };
  }

  function serviceWithObservedTransaction(
    client: PrismaClient,
    onPid: (pid: number) => void,
  ): MulticurrencyService {
    return new MulticurrencyService({
      membership: client.membership,
      exchangeRate: client.exchangeRate,
      $transaction: (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => client.$transaction(async (tx) => {
        onPid(await backendPid(tx));
        return callback(tx);
      }),
    } as unknown as PrismaService);
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

  async function persistExpenseSnapshot(
    tx: Prisma.TransactionClient,
    ctx: Awaited<ReturnType<typeof fixture>>,
    amountMinor: number,
  ) {
    const conversion = await new CurrencyConversionService(tx as unknown as PrismaService).convert(
      {
        tenantId: ctx.tenant.id,
        amount: amountMinor,
        originalCurrency: 'USD',
        functionalCurrency: 'VES',
        conversionDate: '2026-08-09',
      },
      tx,
    );
    return tx.expense.create({
      data: {
        tenantId: ctx.tenant.id,
        buildingId: ctx.building.id,
        period: '2026-08',
        liquidationPeriod: '2026-08',
        categoryId: ctx.category.id,
        amountMinor,
        currencyCode: 'USD',
        invoiceDate: new Date('2026-08-09T00:00:00.000Z'),
        status: 'VALIDATED',
        createdByMembershipId: ctx.membership.id,
        validatedByMembershipId: ctx.membership.id,
        validatedAt: new Date(),
        functionalAmountMinor: conversion.functionalAmount,
        functionalCurrencyCode: conversion.functionalCurrency,
        exchangeRateId: conversion.sourceExchangeRateId,
        exchangeRateValue: conversion.appliedRate,
        exchangeRateDirection: conversion.direction,
        exchangeRateEffectiveAt: conversion.sourceEffectiveAt,
        conversionDate: conversion.conversionDate,
      },
    });
  }

  it('makes update wait for a snapshot transaction, then reject after the snapshot references the rate', async () => {
    const ctx = await fixture('snapshot-first');
    let releaseSnapshot!: () => void;
    const snapshotMayCommit = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
    let snapshotLocked!: () => void;
    const snapshotHasLock = new Promise<void>((resolve) => { snapshotLocked = resolve; });
    const updaterPid = deferredPid();

    const snapshotTransaction = firstClient.$transaction(async (tx) => {
      const expense = await persistExpenseSnapshot(tx, ctx, 100);
      snapshotLocked();
      await snapshotMayCommit;
      return expense;
    });

    await snapshotHasLock;
    const update = serviceWithObservedTransaction(secondClient, updaterPid.resolve)
      .update(ctx.tenant.id, ctx.rate.id, { rate: '40', effectiveAt: '2026-08-09' })
      .catch((error: unknown) => error);
    await waitUntilBlocked(await updaterPid.promise);
    releaseSnapshot();

    const [expense, updateError] = await Promise.all([snapshotTransaction, update]);
    expect(expense.exchangeRateId).toBe(ctx.rate.id);
    expect(expense.exchangeRateValue?.toString()).toBe('36.5');
    expect(updateError).toMatchObject({ response: expect.objectContaining({ code: 'EXCHANGE_RATE_IN_USE' }) });
  }, 20000);

  it('makes snapshot wait for update, then re-read and persist the updated ExchangeRate value', async () => {
    const ctx = await fixture('update-first');
    let releaseUpdate!: () => void;
    const updateMayCommit = new Promise<void>((resolve) => { releaseUpdate = resolve; });
    let updateLocked!: () => void;
    const updateHasLock = new Promise<void>((resolve) => { updateLocked = resolve; });
    const snapshotPid = deferredPid();

    const updateTransaction = firstClient.$transaction(async (tx) => {
      await acquireExchangeRateLock(tx, ctx.tenant.id, ctx.rate.id);
      await tx.exchangeRate.update({ where: { id: ctx.rate.id }, data: { rate: new Prisma.Decimal('40') } });
      updateLocked();
      await updateMayCommit;
    });

    await updateHasLock;
    const snapshotTransaction = secondClient.$transaction(async (tx) => {
      snapshotPid.resolve(await backendPid(tx));
      return persistExpenseSnapshot(tx, ctx, 100);
    });
    await waitUntilBlocked(await snapshotPid.promise);
    releaseUpdate();

    const [, expense] = await Promise.all([updateTransaction, snapshotTransaction]);
    expect(expense.exchangeRateId).toBe(ctx.rate.id);
    expect(expense.exchangeRateValue?.toString()).toBe('40');
    expect(expense.functionalAmountMinor).toBe(4000);
  }, 20000);

  it('does not block different ExchangeRate ids', async () => {
    const ctx = await fixture('different-rates');
    const otherRate = await observer.exchangeRate.create({
      data: {
        tenantId: ctx.tenant.id,
        baseCurrency: 'ARS',
        quoteCurrency: 'VES',
        rate: new Prisma.Decimal('2'),
        effectiveAt: new Date('2026-08-09T00:00:00.000Z'),
      },
    });
    let release!: () => void;
    const releaseLock = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const firstLocked = new Promise<void>((resolve) => { locked = resolve; });

    const holder = firstClient.$transaction(async (tx) => {
      await acquireExchangeRateLock(tx, ctx.tenant.id, ctx.rate.id);
      locked();
      await releaseLock;
    });
    await firstLocked;

    await expect(
      Promise.race([
        secondClient.$transaction((tx) => acquireExchangeRateLock(tx, ctx.tenant.id, otherRate.id)).then(() => 'acquired'),
        new Promise((resolve) => setTimeout(() => resolve('blocked'), 250)),
      ]),
    ).resolves.toBe('acquired');
    release();
    await holder;
  }, 20000);

  it('serializes DIRECT rate creation with INVERSE snapshot selection', async () => {
    const ctx = await fixture('create-vs-selection');
    await observer.exchangeRate.delete({ where: { id: ctx.rate.id } });
    const inverseRate = await observer.exchangeRate.create({
      data: {
        tenantId: ctx.tenant.id,
        baseCurrency: 'VES',
        quoteCurrency: 'USD',
        rate: new Prisma.Decimal('0.025'),
        effectiveAt: new Date('2026-08-09T00:00:00.000Z'),
      },
    });
    let releaseSnapshot!: () => void;
    const snapshotMayCommit = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
    let snapshotSelected!: () => void;
    const snapshotHasSelected = new Promise<void>((resolve) => { snapshotSelected = resolve; });
    const creatorPid = deferredPid();

    const snapshotTransaction = firstClient.$transaction(async (tx) => {
      const expense = await persistExpenseSnapshot(tx, ctx, 100);
      snapshotSelected();
      await snapshotMayCommit;
      return expense;
    });

    await snapshotHasSelected;
    const createdDirectRate = serviceWithObservedTransaction(secondClient, creatorPid.resolve)
      .create(ctx.tenant.id, undefined, { baseCurrency: 'USD', quoteCurrency: 'VES', rate: '40', effectiveAt: '2026-08-09' });
    await waitUntilBlocked(await creatorPid.promise);
    releaseSnapshot();

    const [expense, directRate] = await Promise.all([snapshotTransaction, createdDirectRate]);
    expect(expense.exchangeRateId).toBe(inverseRate.id);
    expect(expense.exchangeRateDirection).toBe('INVERSE');
    expect(expense.exchangeRateValue?.toString()).toBe('40');
    expect(directRate).toMatchObject({ baseCurrency: 'USD', quoteCurrency: 'VES', rate: '40' });
  }, 20000);

  it('serializes DIRECT effectiveAt updates with INVERSE snapshot selection', async () => {
    const ctx = await fixture('update-date-vs-selection');
    await observer.exchangeRate.update({
      where: { id: ctx.rate.id },
      data: { effectiveAt: new Date('2026-08-10T00:00:00.000Z') },
    });
    const inverseRate = await observer.exchangeRate.create({
      data: {
        tenantId: ctx.tenant.id,
        baseCurrency: 'VES',
        quoteCurrency: 'USD',
        rate: new Prisma.Decimal('0.025'),
        effectiveAt: new Date('2026-08-09T00:00:00.000Z'),
      },
    });
    let releaseSnapshot!: () => void;
    const snapshotMayCommit = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
    let snapshotSelected!: () => void;
    const snapshotHasSelected = new Promise<void>((resolve) => { snapshotSelected = resolve; });
    const updaterPid = deferredPid();

    const snapshotTransaction = firstClient.$transaction(async (tx) => {
      const expense = await persistExpenseSnapshot(tx, ctx, 100);
      snapshotSelected();
      await snapshotMayCommit;
      return expense;
    });

    await snapshotHasSelected;
    const updatedDirectRate = serviceWithObservedTransaction(secondClient, updaterPid.resolve)
      .update(ctx.tenant.id, ctx.rate.id, { rate: '36.5', effectiveAt: '2026-08-09' });
    await waitUntilBlocked(await updaterPid.promise);
    releaseSnapshot();

    const [expense, directRate] = await Promise.all([snapshotTransaction, updatedDirectRate]);
    expect(expense.exchangeRateId).toBe(inverseRate.id);
    expect(expense.exchangeRateDirection).toBe('INVERSE');
    expect(expense.exchangeRateValue?.toString()).toBe('40');
    expect(directRate.effectiveAt).toEqual(new Date('2026-08-09T00:00:00.000Z'));
  }, 20000);

  it('does not share the same semantic lock identity across tenants', async () => {
    const first = await fixture('tenant-a');
    const second = await fixture('tenant-b');
    let release!: () => void;
    const releaseLock = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const firstLocked = new Promise<void>((resolve) => { locked = resolve; });

    const holder = firstClient.$transaction(async (tx) => {
      await acquireExchangeRateLock(tx, first.tenant.id, 'same-logical-rate-id');
      locked();
      await releaseLock;
    });
    await firstLocked;

    await expect(
      Promise.race([
        secondClient.$transaction((tx) => acquireExchangeRateLock(tx, second.tenant.id, 'same-logical-rate-id')).then(() => 'acquired'),
        new Promise((resolve) => setTimeout(() => resolve('blocked'), 250)),
      ]),
    ).resolves.toBe('acquired');
    release();
    await holder;
  }, 20000);

  it('does not share the same pair lock identity across tenants', async () => {
    const first = await fixture('pair-tenant-a');
    const second = await fixture('pair-tenant-b');
    let release!: () => void;
    const releaseLock = new Promise<void>((resolve) => { release = resolve; });
    let locked!: () => void;
    const firstLocked = new Promise<void>((resolve) => { locked = resolve; });

    const holder = firstClient.$transaction(async (tx) => {
      await acquireExchangeRatePairLock(tx, first.tenant.id, 'USD', 'VES');
      locked();
      await releaseLock;
    });
    await firstLocked;

    await expect(
      Promise.race([
        secondClient.$transaction((tx) => acquireExchangeRatePairLock(tx, second.tenant.id, 'USD', 'VES')).then(() => 'acquired'),
        new Promise((resolve) => setTimeout(() => resolve('blocked'), 250)),
      ]),
    ).resolves.toBe('acquired');
    release();
    await holder;
  }, 20000);
});
