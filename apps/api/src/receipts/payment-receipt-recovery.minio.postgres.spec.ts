import * as Minio from 'minio';
import { Readable } from 'node:stream';
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
  objectExists(bucket: string, objectKey: string): Promise<boolean>;
  statObject(bucket: string, objectKey: string): Promise<{ size: number }>;
  getObjectBuffer(bucket: string, objectKey: string): Promise<Buffer>;
  presignDownload(bucket: string, objectKey: string, expirySeconds: number): Promise<string>;
  deleteObject(bucket: string, objectKey: string): Promise<void>;
  listObjects(bucket: string, prefix: string): Promise<string[]>;
}

class MinioReceiptStorage implements ReceiptStorage {
  private readonly client: Minio.Client;

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

  async uploadBuffer(
    bucket: string,
    objectKey: string,
    content: Buffer,
    contentType: string,
  ): Promise<void> {
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

  async statObject(bucket: string, objectKey: string): Promise<{ size: number }> {
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
      select: { receiptNumber: true, receiptStatus: true },
    });
    expect(failedPayment.receiptNumber).toMatch(/-000001$/);
    expect(failedPayment.receiptStatus).toBe('FAILED');
    objectKey = `tenant/${tenantId}/payments/${payment.id}/receipts/${failedPayment.receiptNumber}.pdf`;
    await expect(
      storage.objectExists(storage.getDefaultBucket(), objectKey),
    ).resolves.toBe(true);

    const freshStorage = new MinioReceiptStorage(
      storage.getDefaultBucket(),
      process.env.MINIO_ENDPOINT!,
      process.env.MINIO_ACCESS_KEY!,
      process.env.MINIO_SECRET_KEY!,
    );
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
    expect(files).toHaveLength(1);
    expect(documents).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(objects).toEqual([objectKey]);
  }, 30000);
});
