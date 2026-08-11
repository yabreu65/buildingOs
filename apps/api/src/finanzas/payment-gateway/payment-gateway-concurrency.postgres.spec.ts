import {
  ChargeStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  PrismaClient,
  TenantType,
} from '@prisma/client';
import { CurrencyConversionService } from '../currency-conversion.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentGatewayService } from './payment-gateway.service';
import {
  PaymentPreference,
  PaymentProvider,
  PaymentStatus as ProviderPaymentStatus,
  WebhookEvent,
} from './interfaces/payment-provider.interface';
import { IdempotencyService } from './webhooks/idempotency.service';

const enabled =
  process.env.RUN_POSTGRES_INTEGRATION === '1' &&
  process.env.POSTGRES_TEST_DB_NAME === 'buildingos_3e3_acceptance';
const describePostgres = enabled ? describe : describe.skip;

class DeterministicProvider implements PaymentProvider {
  readonly providerName = 'mercadopago' as const;

  constructor(private readonly event: WebhookEvent) {}

  async createPreference(): Promise<PaymentPreference> {
    throw new Error('Not used by this test');
  }

  async handleWebhook(): Promise<WebhookEvent> {
    return this.event;
  }

  async getChargeStatus(): Promise<ProviderPaymentStatus> {
    return 'PAID';
  }
}

const noOpIdempotency = {
  isProcessed: async () => false,
  cacheProcessed: async () => undefined,
} as unknown as IdempotencyService;

describePostgres('Payment gateway PostgreSQL webhook concurrency', () => {
  let observer: PrismaClient;
  let blocker: PrismaClient;
  let firstPrisma: PrismaService;
  let secondPrisma: PrismaService;
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  const eventIds: string[] = [];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    const clientUrl = (applicationName: string) => {
      const url = new URL(process.env.DATABASE_URL!);
      url.searchParams.set('application_name', applicationName);
      return url.toString();
    };
    observer = new PrismaClient();
    blocker = new PrismaClient();
    firstPrisma = new PrismaService({
      datasources: { db: { url: clientUrl('gateway-concurrency-first') } },
    });
    secondPrisma = new PrismaService({
      datasources: { db: { url: clientUrl('gateway-concurrency-second') } },
    });
    await Promise.all([
      observer.$connect(),
      blocker.$connect(),
      firstPrisma.$connect(),
      secondPrisma.$connect(),
    ]);
    const [database] = await observer.$queryRaw<Array<{ name: string }>>`
      SELECT current_database() AS name
    `;
    if (database?.name !== 'buildingos_3e3_acceptance') {
      throw new Error(`Refusing destructive test database ${database?.name ?? 'unknown'}`);
    }
  });

  afterEach(async () => {
    for (const eventId of eventIds.splice(0)) {
      await observer.processedWebhookEvent.deleteMany({ where: { eventId } });
    }
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
      blocker?.$disconnect(),
      firstPrisma?.$disconnect(),
      secondPrisma?.$disconnect(),
    ]);
  });

  async function waitForBothServiceTransactionsToBlock(): Promise<number[]> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const activity = await observer.$queryRaw<Array<{ pid: number }>>(Prisma.sql`
        SELECT pid
        FROM pg_stat_activity
        WHERE application_name IN ('gateway-concurrency-first', 'gateway-concurrency-second')
          AND wait_event_type = 'Lock'
      `);
      const pids = [...new Set(activity.map(({ pid }) => pid))];
      if (pids.length === 2) return pids;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Both gateway transactions did not reach a database lock wait');
  }

  async function fixture() {
    const suffix = `${Date.now()}-${Math.random()}`;
    const tenant = await observer.tenant.create({
      data: {
        name: `Gateway concurrency ${suffix}`,
        type: TenantType.ADMINISTRADORA,
        functionalCurrency: 'ARS',
      },
    });
    tenantIds.push(tenant.id);
    const user = await observer.user.create({
      data: {
        email: `gateway-concurrency-${suffix}@buildingos.local`,
        name: 'Gateway concurrency resident',
        passwordHash: 'test',
      },
    });
    userIds.push(user.id);
    const building = await observer.building.create({
      data: {
        tenantId: tenant.id,
        name: `Building ${suffix}`,
        alias: `GW-${suffix}`,
        address: 'Test',
      },
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
    const charge = await observer.charge.create({
      data: {
        tenantId: tenant.id,
        buildingId: building.id,
        unitId: unit.id,
        period: '2026-08',
        concept: 'Concurrent gateway reservation',
        amount: 10000,
        currency: 'ARS',
        dueDate: new Date('2026-08-31T00:00:00.000Z'),
      },
    });
    const externalId = `gateway-external-${suffix}`;
    const payment = await observer.payment.create({
      data: {
        tenantId: tenant.id,
        buildingId: building.id,
        unitId: unit.id,
        amount: 10000,
        currency: 'ARS',
        method: PaymentMethod.TRANSFER,
        status: PaymentStatus.SUBMITTED,
        reference: externalId,
        createdByUserId: user.id,
        functionalAmountMinor: 10000,
        functionalCurrencyCode: 'ARS',
        exchangeRateValue: new Prisma.Decimal(1),
        exchangeRateDirection: 'IDENTITY',
        conversionDate: new Date('2026-08-10T00:00:00.000Z'),
      },
    });
    const allocation = await observer.paymentAllocation.create({
      data: {
        tenantId: tenant.id,
        paymentId: payment.id,
        chargeId: charge.id,
        amount: 10000,
        paymentOriginalAmountMinor: 10000,
      },
    });
    const event: WebhookEvent = {
      eventId: `gateway-event-${suffix}`,
      eventType: 'payment.updated',
      chargeId: charge.id,
      externalId,
      status: 'PAID',
      amount: 10000,
      currency: 'ARS',
      paidAt: '2026-08-10',
      rawPayload: { source: 'deterministic-test-provider' },
    };
    eventIds.push(event.eventId);
    return { allocation, charge, event, payment };
  }

  it('serializes duplicate paid webhooks and reuses the submitted reservation exactly once', async () => {
    const ctx = await fixture();
    const provider = new DeterministicProvider(ctx.event);
    const firstService = new PaymentGatewayService(
      provider,
      firstPrisma,
      noOpIdempotency,
      new CurrencyConversionService(firstPrisma),
    );
    const secondService = new PaymentGatewayService(
      provider,
      secondPrisma,
      noOpIdempotency,
      new CurrencyConversionService(secondPrisma),
    );
    const eventLockKey = `webhook:${provider.providerName}:${ctx.event.eventId}`;
    let releaseBlocker!: () => void;
    const holdBlocker = new Promise<void>((resolve) => { releaseBlocker = resolve; });
    let blockerReady!: () => void;
    const blockerAcquired = new Promise<void>((resolve) => { blockerReady = resolve; });
    const blockingTransaction = blocker.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${eventLockKey}, 0))`,
      );
      blockerReady();
      await holdBlocker;
    });
    await blockerAcquired;

    const first = firstService.processWebhookEvent(ctx.event.rawPayload, 'sig', 'mercadopago');
    const second = secondService.processWebhookEvent(ctx.event.rawPayload, 'sig', 'mercadopago');
    const blockedPids = await waitForBothServiceTransactionsToBlock();
    expect(new Set(blockedPids).size).toBe(2);
    releaseBlocker();
    await blockingTransaction;

    const results = await Promise.all([first, second]);
    expect(results).toEqual([
      expect.objectContaining({ chargeUpdated: true }),
      expect.objectContaining({ chargeUpdated: true }),
    ]);

    const [payment, charge, allocations, processedEvents] = await Promise.all([
      observer.payment.findUniqueOrThrow({ where: { id: ctx.payment.id } }),
      observer.charge.findUniqueOrThrow({ where: { id: ctx.charge.id } }),
      observer.paymentAllocation.findMany({ where: { paymentId: ctx.payment.id } }),
      observer.processedWebhookEvent.findMany({ where: { eventId: ctx.event.eventId } }),
    ]);
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({
      id: ctx.allocation.id,
      amount: 10000,
      paymentOriginalAmountMinor: 10000,
    });
    expect(processedEvents).toHaveLength(1);
    expect(payment.status).toBe(PaymentStatus.RECONCILED);
    expect(payment.paymentEventId).toBe(ctx.event.eventId);
    expect(charge.status).toBe(ChargeStatus.PAID);

    await expect(
      firstService.processWebhookEvent(ctx.event.rawPayload, 'sig', 'mercadopago'),
    ).resolves.toEqual(expect.objectContaining({ chargeUpdated: true }));
    await expect(observer.paymentAllocation.count({ where: { paymentId: ctx.payment.id } }))
      .resolves.toBe(1);
    await expect(observer.processedWebhookEvent.count({ where: { eventId: ctx.event.eventId } }))
      .resolves.toBe(1);
  });
});
