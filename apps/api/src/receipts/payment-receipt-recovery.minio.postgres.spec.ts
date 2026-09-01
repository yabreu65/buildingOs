import * as Minio from 'minio';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import {
  ChargeStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  PrismaClient,
  TenantType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentReceiptService } from './payment-receipt.service';

const databaseEnabled =
  process.env.RUN_POSTGRES_INTEGRATION === '1' &&
  (process.env.POSTGRES_TEST_DB_NAME === 'buildingos_local_v2_test' ||
    process.env.POSTGRES_TEST_DB_NAME === 'buildingos_3e3_acceptance');
const minioEnabled =
  process.env.RUN_MINIO_INTEGRATION === '1' &&
  Boolean(
    process.env.MINIO_ENDPOINT &&
      process.env.MINIO_ACCESS_KEY &&
      process.env.MINIO_SECRET_KEY &&
      process.env.MINIO_BUCKET,
  );
const describeMinioRecovery = databaseEnabled && minioEnabled ? describe : describe.skip;

interface ReceiptStorage {
  getDefaultBucket(): string;
  uploadBuffer(bucket: string, objectKey: string, content: Buffer, contentType: string): Promise<void>;
  uploadBufferIfAbsent(bucket: string, objectKey: string, content: Buffer, contentType: string): Promise<boolean>;
  objectExists(bucket: string, objectKey: string): Promise<boolean>;
  statObject(bucket: string, objectKey: string): Promise<{
    size: number;
    etag?: string;
    lastModified?: Date;
    metaData?: Record<string, string>;
  }>;
  getObjectBuffer(bucket: string, objectKey: string): Promise<Buffer>;
  presignDownload(bucket: string, objectKey: string, expirySeconds: number): Promise<string>;
  deleteObject(bucket: string, objectKey: string): Promise<void>;
  listObjects(bucket: string, prefix: string): Promise<string[]>;
}

class MinioReceiptStorage implements ReceiptStorage {
  private readonly client: Minio.Client;
  readonly putCalls: string[] = [];

  constructor(
    private readonly bucket: string,
    endpoint: string,
    accessKey: string,
    secretKey: string,
  ) {
    const url = new URL(endpoint);
    this.client = new Minio.Client({
      endPoint: url.hostname,
      port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
      useSSL: url.protocol === 'https:',
      accessKey,
      secretKey,
      region: 'us-east-1',
      pathStyle: true,
    });
  }

  getDefaultBucket(): string {
    return this.bucket;
  }

  async ensureBucket(): Promise<void> {
    if (!(await this.client.bucketExists(this.bucket))) {
      await this.client.makeBucket(this.bucket, 'us-east-1');
    }
  }

  async enableVersioning(): Promise<void> {
    await this.client.setBucketVersioning(this.bucket, { Status: 'Enabled' });
  }

  async countObjectVersions(prefix: string): Promise<number> {
    const stream = this.client.listObjects(this.bucket, prefix, true, { IncludeVersion: true });
    return new Promise<number>((resolve, reject) => {
      let count = 0;
      stream.on('data', () => {
        count += 1;
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(count));
    });
  }

  async uploadBuffer(
    bucket: string,
    objectKey: string,
    content: Buffer,
    contentType: string,
  ): Promise<void> {
    this.putCalls.push(`${bucket}/${objectKey}`);
    await this.client.putObject(
      bucket,
      objectKey,
      Readable.from([content]),
      content.length,
      { 'Content-Type': contentType },
    );
  }

  async objectExists(bucket: string, objectKey: string): Promise<boolean> {
    try {
      await this.client.statObject(bucket, objectKey);
      return true;
    } catch (error: unknown) {
      const errorLike = error as { code?: string; statusCode?: number };
      if (errorLike.code === 'NotFound' || errorLike.statusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  async uploadBufferIfAbsent(
    bucket: string,
    objectKey: string,
    content: Buffer,
    contentType: string,
  ): Promise<boolean> {
    this.putCalls.push(`${bucket}/${objectKey}`);
    try {
      await this.client.putObject(
        bucket,
        objectKey,
        Readable.from([content]),
        content.length,
        { 'Content-Type': contentType, 'If-None-Match': '*' },
      );
      return true;
    } catch (error: unknown) {
      const errorLike = error as { code?: string; statusCode?: number };
      if (errorLike.code === 'PreconditionFailed' || errorLike.statusCode === 412) {
        return false;
      }
      throw error;
    }
  }

  async statObject(bucket: string, objectKey: string): Promise<{
    size: number;
    etag?: string;
    lastModified?: Date;
    metaData?: Record<string, string>;
  }> {
    return this.client.statObject(bucket, objectKey);
  }

  async getObjectBuffer(bucket: string, objectKey: string): Promise<Buffer> {
    const stream = await this.client.getObject(bucket, objectKey);
    const chunks: Buffer[] = [];
    return new Promise<Buffer>((resolve, reject) => {
      stream.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  async presignDownload(
    bucket: string,
    objectKey: string,
    expirySeconds: number,
  ): Promise<string> {
    return this.client.presignedGetObject(bucket, objectKey, expirySeconds);
  }

  async deleteObject(bucket: string, objectKey: string): Promise<void> {
    await this.client.removeObject(bucket, objectKey);
  }

  async listObjects(bucket: string, prefix: string): Promise<string[]> {
    const names: string[] = [];
    const stream = this.client.listObjects(bucket, prefix, true);
    return new Promise<string[]>((resolve, reject) => {
      stream.on('data', (item) => {
        if (item.name) names.push(item.name);
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(names));
    });
  }
}

function receiptService(
  prisma: PrismaService,
  storage: MinioReceiptStorage,
): PaymentReceiptService {
  return new PaymentReceiptService(
    prisma,
    storage as unknown as never,
    { createNotification: jest.fn().mockResolvedValue(undefined) } as never,
  );
}

describeMinioRecovery('Payment receipt PostgreSQL/MinIO recovery', () => {
  let observer: PrismaClient;
  let firstPrisma: PrismaService;
  let secondPrisma: PrismaService;
  let storage: MinioReceiptStorage;
  let tenantId: string;
  let userId: string;
  let objectKey: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !process.env.POSTGRES_TEST_DB_NAME) {
      throw new Error('DATABASE_URL and POSTGRES_TEST_DB_NAME are required');
    }
    storage = new MinioReceiptStorage(
      process.env.MINIO_BUCKET!,
      process.env.MINIO_ENDPOINT!,
      process.env.MINIO_ACCESS_KEY!,
      process.env.MINIO_SECRET_KEY!,
    );
    await storage.ensureBucket();
    await storage.enableVersioning();

    const clientUrl = (applicationName: string) => {
      const url = new URL(process.env.DATABASE_URL!);
      url.searchParams.set('application_name', applicationName);
      return url.toString();
    };
    observer = new PrismaClient();
    firstPrisma = new PrismaService({
      datasources: { db: { url: clientUrl('receipt-recovery-minio-first') } },
    });
    secondPrisma = new PrismaService({
      datasources: { db: { url: clientUrl('receipt-recovery-minio-second') } },
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
      throw new Error(`Refusing destructive test database ${database?.name ?? 'unknown'}`);
    }
  });

  afterAll(async () => {
    if (objectKey) {
      await storage.deleteObject(storage.getDefaultBucket(), objectKey).catch(() => undefined);
    }
    if (tenantId) {
      await observer.tenant.delete({ where: { id: tenantId } });
    }
    if (userId) {
      await observer.user.delete({ where: { id: userId } });
    }
    await Promise.all([
      observer?.$disconnect(),
      firstPrisma?.$disconnect(),
      secondPrisma?.$disconnect(),
    ]);
  });

  async function createLegacyOrphanContext(suffix: string) {
    const tenant = await observer.tenant.create({
      data: {
        name: `Receipt orphan takeover ${suffix}`,
        type: TenantType.ADMINISTRADORA,
        functionalCurrency: 'ARS',
      },
    });
    const user = await observer.user.create({
      data: {
        email: `receipt-takeover-${suffix}@buildingos.local`,
        name: 'Receipt takeover resident',
        passwordHash: 'test',
      },
    });
    const building = await observer.building.create({
      data: {
        tenantId: tenant.id,
        name: `Receipt takeover building ${suffix}`,
        alias: `RT-${suffix}`,
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

  async function createLegacyOrphanPayment(
    context: Awaited<ReturnType<typeof createLegacyOrphanContext>>,
    receiptNumber: string,
  ) {
    const payment = await observer.payment.create({
      data: {
        tenantId: context.tenant.id,
        buildingId: context.building.id,
        unitId: context.unit.id,
        amount: 10000,
        currency: 'ARS',
        method: PaymentMethod.TRANSFER,
        status: PaymentStatus.APPROVED,
        receiptStatus: 'FAILED',
        receiptNumber,
        createdByUserId: context.user.id,
        approvedByUserId: context.user.id,
        approvedAt: new Date('2026-08-10T00:00:00.000Z'),
      },
    });
    return {
      payment,
      objectKey: `tenant/${context.tenant.id}/payments/${payment.id}/receipts/${receiptNumber}.pdf`,
    };
  }

  it('takes over expired legacy orphan leases repeatedly without changing the object', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const context = await createLegacyOrphanContext(suffix);
    const objectKeys: string[] = [];

    try {
      for (let index = 1; index <= 10; index += 1) {
        const receiptNumber = `R-EXPIRED-${suffix}-${index}`;
        const { payment, objectKey } = await createLegacyOrphanPayment(
          context,
          receiptNumber,
        );
        const orphanPdf = Buffer.from(`%PDF-expired-orphan-${index}`);
        await storage.uploadBuffer(
          storage.getDefaultBucket(),
          objectKey,
          orphanPdf,
          'application/pdf',
        );
        objectKeys.push(objectKey);
        const statBefore = await storage.statObject(
          storage.getDefaultBucket(),
          objectKey,
        );
        const checksum = createHash('sha256').update(orphanPdf).digest('hex');
        const versionsBefore = await storage.countObjectVersions(objectKey);
        const putCallsBefore = storage.putCalls.length;
        const expiredToken = `expired-owner-${index}`;
        const expiredLease = new Date('2020-01-01T00:00:00.000Z');
        await observer.payment.update({
          where: { id: payment.id },
          data: {
            receiptGenerationToken: expiredToken,
            receiptGenerationLeaseUntil: expiredLease,
          },
        });

        const result = await receiptService(firstPrisma, storage).ensureReceiptForPayment(
          context.tenant.id,
          payment.id,
        );
        const [persistedPayment, files, documents, audits] = await Promise.all([
          observer.payment.findUniqueOrThrow({ where: { id: payment.id } }),
          observer.file.findMany({ where: { tenantId: context.tenant.id, objectKey } }),
          observer.document.findMany({ where: { tenantId: context.tenant.id } }),
          observer.paymentAuditLog.findMany({
            where: { tenantId: context.tenant.id, paymentId: payment.id, action: 'RECEIPT_GENERATED' },
          }),
        ]);
        const statAfter = await storage.statObject(
          storage.getDefaultBucket(),
          objectKey,
        );

        expect(result?.receiptNumber).toBe(receiptNumber);
        expect(persistedPayment.receiptStatus).toBe('READY');
        expect(persistedPayment.receiptSnapshot).toBeNull();
        expect(persistedPayment.receiptNumber).toBe(receiptNumber);
        expect(persistedPayment.receiptGenerationToken).toBeNull();
        expect(persistedPayment.receiptGenerationLeaseUntil).toBeNull();
        expect(persistedPayment.receiptGeneratedAt).toEqual(statBefore.lastModified);
        expect(statAfter.size).toBe(orphanPdf.length);
        expect(statAfter.etag).toBe(statBefore.etag);
        expect(statAfter.lastModified).toEqual(statBefore.lastModified);
        expect(await storage.getObjectBuffer(storage.getDefaultBucket(), objectKey)).toEqual(orphanPdf);
        expect(createHash('sha256').update(await storage.getObjectBuffer(storage.getDefaultBucket(), objectKey)).digest('hex')).toBe(checksum);
        expect(await storage.countObjectVersions(objectKey)).toBe(versionsBefore);
        expect(storage.putCalls.length).toBe(putCallsBefore);
        expect(files).toHaveLength(1);
        expect(documents).toHaveLength(index);
        expect(audits).toHaveLength(1);
      }
    } finally {
      await Promise.all(
        objectKeys.map((key) => storage.deleteObject(storage.getDefaultBucket(), key).catch(() => undefined)),
      );
      await observer.tenant.delete({ where: { id: context.tenant.id } });
      await observer.user.delete({ where: { id: context.user.id } });
    }
  }, 60000);

  it('preserves an active legacy orphan lease and does not adopt its object', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const context = await createLegacyOrphanContext(suffix);
    const receiptNumber = `R-ACTIVE-${suffix}`;
    const { payment, objectKey } = await createLegacyOrphanPayment(context, receiptNumber);
    const orphanPdf = Buffer.from('%PDF-active-orphan');

    try {
      await storage.uploadBuffer(
        storage.getDefaultBucket(),
        objectKey,
        orphanPdf,
        'application/pdf',
      );
      const activeToken = 'active-owner';
      const activeLease = new Date('2099-01-01T00:00:00.000Z');
      await observer.payment.update({
        where: { id: payment.id },
        data: {
          receiptGenerationToken: activeToken,
          receiptGenerationLeaseUntil: activeLease,
        },
      });
      const putCallsBefore = storage.putCalls.length;

      await expect(
        receiptService(firstPrisma, storage).ensureReceiptForPayment(
          context.tenant.id,
          payment.id,
        ),
      ).rejects.toMatchObject({
        response: { message: 'RECEIPT_GENERATION_IN_PROGRESS' },
      });

      const [persistedPayment, files, documents, audits] = await Promise.all([
        observer.payment.findUniqueOrThrow({ where: { id: payment.id } }),
        observer.file.findMany({ where: { tenantId: context.tenant.id } }),
        observer.document.findMany({ where: { tenantId: context.tenant.id } }),
        observer.paymentAuditLog.findMany({
          where: { tenantId: context.tenant.id, paymentId: payment.id, action: 'RECEIPT_GENERATED' },
        }),
      ]);
      expect(persistedPayment.receiptGenerationToken).toBe(activeToken);
      expect(persistedPayment.receiptGenerationLeaseUntil).toEqual(activeLease);
      expect(files).toHaveLength(0);
      expect(documents).toHaveLength(0);
      expect(audits).toHaveLength(0);
      expect(storage.putCalls.length).toBe(putCallsBefore);
    } finally {
      await storage.deleteObject(storage.getDefaultBucket(), objectKey).catch(() => undefined);
      await observer.tenant.delete({ where: { id: context.tenant.id } });
      await observer.user.delete({ where: { id: context.user.id } });
    }
  }, 30000);

  it('recovers a failed finalization with a fresh service and durable MinIO object', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tenant = await observer.tenant.create({
      data: {
        name: `Receipt MinIO recovery ${suffix}`,
        type: TenantType.ADMINISTRADORA,
        functionalCurrency: 'ARS',
      },
    });
    tenantId = tenant.id;
    const user = await observer.user.create({
      data: {
        email: `receipt-minio-${suffix}@buildingos.local`,
        name: 'Receipt MinIO resident',
        passwordHash: 'test',
      },
    });
    userId = user.id;
    const building = await observer.building.create({
      data: {
        tenantId,
        name: `Receipt MinIO building ${suffix}`,
        alias: `RM-${suffix}`,
        address: 'Test',
      },
    });
    const unit = await observer.unit.create({
      data: {
        tenantId,
        buildingId: building.id,
        code: '1',
        label: '1',
        unitType: 'APARTAMENTO',
        occupancyStatus: 'OCCUPIED',
        isBillable: true,
      },
    });
    const payment = await observer.payment.create({
      data: {
        tenantId,
        buildingId: building.id,
        unitId: unit.id,
        amount: 10000,
        currency: 'ARS',
        method: PaymentMethod.TRANSFER,
        status: PaymentStatus.APPROVED,
        createdByUserId: userId,
        approvedByUserId: userId,
        approvedAt: new Date('2026-08-10T00:00:00.000Z'),
      },
    });

    const runTransaction = firstPrisma.$transaction.bind(firstPrisma) as unknown as (
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) => Promise<unknown>;
    let transactionCount = 0;
    const failingPrisma = {
      $transaction: async (
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
      ): Promise<unknown> => {
        transactionCount += 1;
        return runTransaction(async (tx) => {
          if (transactionCount !== 2) return callback(tx);
          const failingTx = new Proxy(tx, {
            get(target, property, receiver) {
              if (property === 'document') {
                return {
                  ...target.document,
                  create: async (
                    ..._args: Parameters<Prisma.TransactionClient['document']['create']>
                  ) => {
                    throw new Error('simulated DB finalization failure');
                  },
                };
              }
              return Reflect.get(target, property, receiver);
            },
          });
          return callback(failingTx);
        });
      },
    };
    const firstService = new PaymentReceiptService(
      failingPrisma as unknown as PrismaService,
      storage as unknown as never,
      { createNotification: jest.fn().mockResolvedValue(undefined) } as never,
    );

    await expect(
      firstService.ensureReceiptForPayment(tenantId, payment.id),
    ).resolves.toBeNull();

    const failedPayment = await observer.payment.findUniqueOrThrow({
      where: { id: payment.id },
      select: {
        receiptNumber: true,
        receiptStatus: true,
        receiptSnapshot: true,
        receiptSnapshotHash: true,
        receiptSnapshotVersion: true,
      },
    });
    expect(failedPayment.receiptNumber).toMatch(/-000001$/);
    expect(failedPayment.receiptStatus).toBe('FAILED');
    objectKey = `tenant/${tenantId}/payments/${payment.id}/receipts/${failedPayment.receiptNumber}.pdf`;
    await expect(
      storage.objectExists(storage.getDefaultBucket(), objectKey),
    ).resolves.toBe(true);
    const firstPdf = await storage.getObjectBuffer(
      storage.getDefaultBucket(),
      objectKey,
    );

    const freshStorage = new MinioReceiptStorage(
      storage.getDefaultBucket(),
      process.env.MINIO_ENDPOINT!,
      process.env.MINIO_ACCESS_KEY!,
      process.env.MINIO_SECRET_KEY!,
    );
    await Promise.all([
      observer.tenant.update({
        where: { id: tenantId },
        data: { name: `Mutated tenant ${suffix}`, brandName: 'Mutated brand' },
      }),
      observer.building.update({
        where: { id: building.id },
        data: { name: `Mutated building ${suffix}` },
      }),
      observer.unit.update({
        where: { id: unit.id },
        data: { label: `MUTATED-${suffix}` },
      }),
      observer.user.update({
        where: { id: userId },
        data: { name: 'Mutated approver' },
      }),
    ]);
    const freshService = new PaymentReceiptService(
      secondPrisma,
      freshStorage as unknown as never,
      { createNotification: jest.fn().mockResolvedValue(undefined) } as never,
    );
    const result = await freshService.ensureReceiptForPayment(tenantId, payment.id);

    expect(result?.receiptNumber).toBe(failedPayment.receiptNumber);
    expect(result?.fileKey).toBe(objectKey);
    const [persistedPayment, files, documents, audits, objects] = await Promise.all([
      observer.payment.findUniqueOrThrow({ where: { id: payment.id } }),
      observer.file.findMany({ where: { tenantId } }),
      observer.document.findMany({ where: { tenantId } }),
      observer.paymentAuditLog.findMany({
        where: { tenantId, paymentId: payment.id, action: 'RECEIPT_GENERATED' },
      }),
      freshStorage.listObjects(storage.getDefaultBucket(), `tenant/${tenantId}/`),
    ]);
    expect(persistedPayment.receiptStatus).toBe('READY');
    expect(persistedPayment.receiptNumber).toBe(failedPayment.receiptNumber);
    expect(persistedPayment.receiptSnapshot).toEqual(failedPayment.receiptSnapshot);
    expect(persistedPayment.receiptSnapshotHash).toBe(failedPayment.receiptSnapshotHash);
    expect(persistedPayment.receiptSnapshotVersion).toBe('PAYMENT_RECEIPT_V1');
    expect(files).toHaveLength(1);
    expect(documents).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(objects).toEqual([objectKey]);
    const recoveredPdf = await freshStorage.getObjectBuffer(
      storage.getDefaultBucket(),
      objectKey,
    );
    expect(recoveredPdf).toEqual(firstPdf);
  }, 30000);

  it('adopts a legacy orphan concurrently without creating a new MinIO version', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tenant = await observer.tenant.create({
      data: {
        name: `Receipt orphan recovery ${suffix}`,
        type: TenantType.ADMINISTRADORA,
        functionalCurrency: 'ARS',
      },
    });
    const user = await observer.user.create({
      data: {
        email: `receipt-orphan-${suffix}@buildingos.local`,
        name: 'Receipt orphan resident',
        passwordHash: 'test',
      },
    });
    const building = await observer.building.create({
      data: {
        tenantId: tenant.id,
        name: `Receipt orphan building ${suffix}`,
        alias: `RO-${suffix}`,
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
    const payment = await observer.payment.create({
      data: {
        tenantId: tenant.id,
        buildingId: building.id,
        unitId: unit.id,
        amount: 10000,
        currency: 'ARS',
        method: PaymentMethod.TRANSFER,
        status: PaymentStatus.APPROVED,
        receiptStatus: 'FAILED',
        receiptNumber: `R-ORPHAN-${suffix}`,
        createdByUserId: user.id,
        approvedByUserId: user.id,
        approvedAt: new Date('2026-08-10T00:00:00.000Z'),
      },
    });
    const orphanKey = `tenant/${tenant.id}/payments/${payment.id}/receipts/${payment.receiptNumber}.pdf`;
    const orphanPdf = Buffer.from('%PDF-legacy-orphan');
    await storage.uploadBuffer(storage.getDefaultBucket(), orphanKey, orphanPdf, 'application/pdf');
    const putCallsBeforeRecovery = storage.putCalls.length;
    const orphanStatBefore = await storage.statObject(storage.getDefaultBucket(), orphanKey);
    const orphanChecksum = createHash('sha256').update(orphanPdf).digest('hex');
    const versionsBefore = await storage.countObjectVersions(orphanKey);
    const sequenceBefore = await observer.receiptSequence.findUnique({
      where: {
        tenantId_year: { tenantId: tenant.id, year: 2026 },
      },
    });

    try {
      const results = await Promise.allSettled([
        receiptService(firstPrisma, storage).ensureReceiptForPayment(tenant.id, payment.id),
        receiptService(secondPrisma, storage).ensureReceiptForPayment(tenant.id, payment.id),
      ]);
      const successfulResults = results.filter(
        (result): result is PromiseFulfilledResult<{ receiptNumber: string } | null> =>
          result.status === 'fulfilled' && result.value !== null,
      );
      expect(successfulResults.length).toBeGreaterThanOrEqual(1);
      for (const result of results) {
        if (result.status === 'rejected') {
          expect(result.reason).toEqual(
            expect.objectContaining({
              response: { message: 'RECEIPT_GENERATION_IN_PROGRESS' },
            }),
          );
        }
      }

      const [persistedPayment, sequenceAfter, files, documents, audits] = await Promise.all([
        observer.payment.findUniqueOrThrow({ where: { id: payment.id } }),
        observer.receiptSequence.findUnique({
          where: {
            tenantId_year: { tenantId: tenant.id, year: 2026 },
          },
        }),
        observer.file.findMany({ where: { tenantId: tenant.id } }),
        observer.document.findMany({ where: { tenantId: tenant.id } }),
        observer.paymentAuditLog.findMany({
          where: { tenantId: tenant.id, paymentId: payment.id, action: 'RECEIPT_GENERATED' },
        }),
      ]);
      expect(persistedPayment.receiptStatus).toBe('READY');
      expect(persistedPayment.receiptNumber).toBe(payment.receiptNumber);
      expect(persistedPayment.receiptSnapshot).toBeNull();
      expect(persistedPayment.receiptSnapshotHash).toBeNull();
      expect(persistedPayment.receiptSnapshotVersion).toBeNull();
      expect(persistedPayment.receiptSnapshotCreatedAt).toBeNull();
      expect(sequenceAfter).toEqual(sequenceBefore);
      expect(files).toHaveLength(1);
      expect(documents).toHaveLength(1);
      expect(audits).toHaveLength(1);
      const orphanStatAfter = await storage.statObject(storage.getDefaultBucket(), orphanKey);
      expect(orphanStatBefore.size).toBe(orphanPdf.length);
      expect(orphanStatBefore.metaData?.['content-type']).toBe('application/pdf');
      expect(orphanStatBefore.etag).toBeDefined();
      expect(orphanStatBefore.lastModified).toBeDefined();
      expect(orphanStatAfter.size).toBe(orphanPdf.length);
      expect(orphanStatAfter.metaData?.['content-type']).toBe('application/pdf');
      expect(orphanStatAfter.etag).toBe(orphanStatBefore.etag);
      expect(orphanStatAfter.lastModified).toEqual(orphanStatBefore.lastModified);
      expect(await storage.getObjectBuffer(storage.getDefaultBucket(), orphanKey)).toEqual(orphanPdf);
      expect(createHash('sha256').update(await storage.getObjectBuffer(storage.getDefaultBucket(), orphanKey)).digest('hex')).toBe(orphanChecksum);
      expect(persistedPayment.receiptGeneratedAt).toEqual(orphanStatBefore.lastModified);
      expect(await storage.countObjectVersions(orphanKey)).toBe(versionsBefore);
      expect(await receiptService(secondPrisma, storage).ensureReceiptForPayment(tenant.id, payment.id)).toEqual(
        expect.objectContaining({
          receiptNumber: payment.receiptNumber,
        }),
      );
      const [retriedPayment, retriedFiles, retriedDocuments, retriedAudits] = await Promise.all([
        observer.payment.findUniqueOrThrow({ where: { id: payment.id } }),
        observer.file.findMany({ where: { tenantId: tenant.id } }),
        observer.document.findMany({ where: { tenantId: tenant.id } }),
        observer.paymentAuditLog.findMany({
          where: { tenantId: tenant.id, paymentId: payment.id, action: 'RECEIPT_GENERATED' },
        }),
      ]);
      expect(retriedPayment.receiptNumber).toBe(payment.receiptNumber);
      expect(retriedPayment.receiptGeneratedAt).toEqual(persistedPayment.receiptGeneratedAt);
      expect(retriedPayment.receiptSnapshot).toBeNull();
      expect(retriedFiles).toHaveLength(1);
      expect(retriedDocuments).toHaveLength(1);
      expect(retriedAudits).toHaveLength(1);
      expect(storage.putCalls.slice(putCallsBeforeRecovery)).toHaveLength(0);
      expect(await storage.countObjectVersions(orphanKey)).toBe(versionsBefore);
    } finally {
      await storage.deleteObject(storage.getDefaultBucket(), orphanKey).catch(() => undefined);
      await observer.tenant.delete({ where: { id: tenant.id } });
      await observer.user.delete({ where: { id: user.id } });
    }
  }, 30000);
});
