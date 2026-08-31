import {
  ChargeStatus,
  PaymentMethod,
  PaymentStatus,
  PrismaClient,
  TenantType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentReceiptService } from './payment-receipt.service';

const enabled =
  process.env.RUN_POSTGRES_INTEGRATION === '1' &&
  (process.env.POSTGRES_TEST_DB_NAME === 'buildingos_local_v2_test' ||
    process.env.POSTGRES_TEST_DB_NAME === 'buildingos_3e3_acceptance');
const describePostgres = enabled ? describe : describe.skip;

class LocalReceiptStorage {
  private readonly objects = new Map<string, Buffer>();
  readonly uploadCalls: string[] = [];

  getDefaultBucket(): string {
    return 'buildingos-receipt-test';
  }

  async uploadBuffer(
    bucket: string,
    objectKey: string,
    content: Buffer,
  ): Promise<void> {
    this.uploadCalls.push(`${bucket}/${objectKey}`);
    this.objects.set(`${bucket}/${objectKey}`, Buffer.from(content));
  }

  async objectExists(bucket: string, objectKey: string): Promise<boolean> {
    return this.objects.has(`${bucket}/${objectKey}`);
  }

  async statObject(
    bucket: string,
    objectKey: string,
  ): Promise<{ size: number }> {
    const object = this.objects.get(`${bucket}/${objectKey}`);
    if (!object) throw new Error('NotFound');
    return { size: object.length };
  }

  async getObjectBuffer(bucket: string, objectKey: string): Promise<Buffer> {
    const object = this.objects.get(`${bucket}/${objectKey}`);
    if (!object) throw new Error('NotFound');
    return Buffer.from(object);
  }

  async presignDownload(bucket: string, objectKey: string): Promise<string> {
    return `http://local.test/${bucket}/${objectKey}`;
  }
}

describePostgres('Payment receipt PostgreSQL concurrency', () => {
  let observer: PrismaClient;
  let firstPrisma: PrismaService;
  let secondPrisma: PrismaService;
  let storage: LocalReceiptStorage;
  const tenantIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    const clientUrl = (applicationName: string) => {
      const url = new URL(process.env.DATABASE_URL!);
      url.searchParams.set('application_name', applicationName);
      return url.toString();
    };
    observer = new PrismaClient();
    firstPrisma = new PrismaService({
      datasources: { db: { url: clientUrl('receipt-concurrency-first') } },
    });
    secondPrisma = new PrismaService({
      datasources: { db: { url: clientUrl('receipt-concurrency-second') } },
    });
    await Promise.all([
      observer.$connect(),
      firstPrisma.$connect(),
      secondPrisma.$connect(),
    ]);
    const [database] = await observer.$queryRaw<Array<{ name: string }>>`
      SELECT current_database() AS name
    `;
    if (
      database?.name !== process.env.POSTGRES_TEST_DB_NAME ||
      (database.name !== 'buildingos_local_v2_test' &&
        database.name !== 'buildingos_3e3_acceptance')
    ) {
      throw new Error(
        `Refusing destructive test database ${database?.name ?? 'unknown'}`,
      );
    }
  });

  beforeEach(() => {
    storage = new LocalReceiptStorage();
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
      firstPrisma?.$disconnect(),
      secondPrisma?.$disconnect(),
    ]);
  });

  async function tenantFixture() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tenant = await observer.tenant.create({
      data: {
        name: `Receipt concurrency ${suffix}`,
        type: TenantType.ADMINISTRADORA,
        functionalCurrency: 'ARS',
      },
    });
    tenantIds.push(tenant.id);
    const user = await observer.user.create({
      data: {
        email: `receipt-concurrency-${suffix}@buildingos.local`,
        name: 'Receipt concurrency resident',
        passwordHash: 'test',
      },
    });
    userIds.push(user.id);
    const building = await observer.building.create({
      data: {
        tenantId: tenant.id,
        name: `Receipt building ${suffix}`,
        alias: `RC-${suffix}`,
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
    return { tenant, user, building, unit };
  }

  async function paymentFixture() {
    const fixture = await tenantFixture();
    const payment = await observer.payment.create({
      data: {
        tenantId: fixture.tenant.id,
        buildingId: fixture.building.id,
        unitId: fixture.unit.id,
        amount: 10000,
        currency: 'ARS',
        method: PaymentMethod.TRANSFER,
        status: PaymentStatus.APPROVED,
        createdByUserId: fixture.user.id,
        approvedByUserId: fixture.user.id,
        approvedAt: new Date('2026-08-10T00:00:00.000Z'),
      },
    });
    return { ...fixture, payment };
  }

  function service(prisma: PrismaService): PaymentReceiptService {
    return new PaymentReceiptService(
      prisma,
      storage as never,
      { createNotification: jest.fn().mockResolvedValue(undefined) } as never,
    );
  }

  it('serializes two retries for the same Payment into one receipt', async () => {
    const fixture = await paymentFixture();
    const first = service(firstPrisma).ensureReceiptForPayment(
      fixture.tenant.id,
      fixture.payment.id,
    );
    const second = service(secondPrisma).ensureReceiptForPayment(
      fixture.tenant.id,
      fixture.payment.id,
    );

    const results = await Promise.all([first, second]);
    const [payment, files, documents, audits] = await Promise.all([
      observer.payment.findUniqueOrThrow({ where: { id: fixture.payment.id } }),
      observer.file.findMany({ where: { tenantId: fixture.tenant.id } }),
      observer.document.findMany({ where: { tenantId: fixture.tenant.id } }),
      observer.paymentAuditLog.findMany({
        where: { paymentId: fixture.payment.id, action: 'RECEIPT_GENERATED' },
      }),
    ]);

    expect(results.every((result) => result !== null)).toBe(true);
    expect(payment.receiptStatus).toBe('READY');
    expect(payment.receiptNumber).toMatch(/-000001$/);
    expect(files).toHaveLength(1);
    expect(documents).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(storage.uploadCalls).toHaveLength(1);
  }, 20000);

  it('allocates distinct numbers when different Payments share a sequence', async () => {
    const fixture = await tenantFixture();
    const payments = await Promise.all(
      [1, 2].map((index) =>
        observer.payment.create({
          data: {
            tenantId: fixture.tenant.id,
            buildingId: fixture.building.id,
            unitId: fixture.unit.id,
            amount: 10000 + index,
            currency: 'ARS',
            method: PaymentMethod.TRANSFER,
            status: PaymentStatus.APPROVED,
            createdByUserId: fixture.user.id,
            approvedByUserId: fixture.user.id,
            approvedAt: new Date('2026-08-10T00:00:00.000Z'),
          },
        }),
      ),
    );

    await Promise.all([
      service(firstPrisma).ensureReceiptForPayment(
        fixture.tenant.id,
        payments[0]!.id,
      ),
      service(secondPrisma).ensureReceiptForPayment(
        fixture.tenant.id,
        payments[1]!.id,
      ),
    ]);

    const persisted = await observer.payment.findMany({
      where: { id: { in: payments.map(({ id }) => id) } },
      orderBy: { receiptNumber: 'asc' },
    });
    expect(persisted.map(({ receiptNumber }) => receiptNumber)).toEqual([
      expect.stringMatching(/-000001$/),
      expect.stringMatching(/-000002$/),
    ]);
    expect(storage.uploadCalls).toHaveLength(2);
  }, 20000);

  it('recovers a RECONCILED Payment without changing financial state', async () => {
    const fixture = await paymentFixture();
    const charge = await observer.charge.create({
      data: {
        tenantId: fixture.tenant.id,
        buildingId: fixture.building.id,
        unitId: fixture.unit.id,
        period: '2026-08',
        concept: 'Receipt recovery charge',
        amount: 10000,
        currency: 'ARS',
        status: ChargeStatus.PAID,
        dueDate: new Date('2026-08-31T00:00:00.000Z'),
      },
    });
    await observer.payment.update({
      where: { id: fixture.payment.id },
      data: { status: PaymentStatus.RECONCILED },
    });
    const allocation = await observer.paymentAllocation.create({
      data: {
        tenantId: fixture.tenant.id,
        paymentId: fixture.payment.id,
        chargeId: charge.id,
        amount: 10000,
        paymentOriginalAmountMinor: 10000,
      },
    });

    await expect(
      service(firstPrisma).ensureReceiptForPayment(
        fixture.tenant.id,
        fixture.payment.id,
      ),
    ).resolves.toEqual(
      expect.objectContaining({ receiptNumber: expect.any(String) }),
    );

    const [payment, persistedAllocation, persistedCharge] = await Promise.all([
      observer.payment.findUniqueOrThrow({ where: { id: fixture.payment.id } }),
      observer.paymentAllocation.findUniqueOrThrow({
        where: { id: allocation.id },
      }),
      observer.charge.findUniqueOrThrow({ where: { id: charge.id } }),
    ]);
    expect(payment.status).toBe(PaymentStatus.RECONCILED);
    expect(payment.receiptStatus).toBe('READY');
    expect(persistedAllocation.amount).toBe(10000);
    expect(persistedCharge.status).toBe(ChargeStatus.PAID);
  }, 20000);
});
