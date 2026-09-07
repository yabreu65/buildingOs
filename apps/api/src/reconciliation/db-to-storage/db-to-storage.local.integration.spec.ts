import { randomUUID } from 'node:crypto';
import { ConfigService } from '../../config/config.service';
import { loadConfig } from '../../config/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../../storage/minio.service';
import { DbToStorageScanner } from './db-to-storage.scanner';
import { PrismaDbToStorageDatabase } from './prisma-db-to-storage.database';
import { StorageStatClient } from './db-to-storage.types';

const runLocalIntegration = process.env.RUN_LOCAL_DB_TO_STORAGE_INTEGRATION === '1';
const localDescribe = runLocalIntegration ? describe : describe.skip;

interface CreatedObject {
  readonly objectKey: string;
  readonly versionId: string;
}

localDescribe('DB-to-storage local integration', () => {
  let prisma: PrismaService;
  let storage: MinioService;
  const createdObjectVersions: CreatedObject[] = [];
  const createdFileIds: string[] = [];
  const createdImportJobIds: string[] = [];

  beforeAll(async () => {
    const config = new ConfigService(loadConfig());
    prisma = new PrismaService();
    storage = new MinioService(config);
    await prisma.$connect();
  });

  afterAll(async () => {
    if (!prisma || !storage) {
      return;
    }

    await prisma.file.deleteMany({ where: { id: { in: createdFileIds } } });
    await prisma.importJob.deleteMany({ where: { id: { in: createdImportJobIds } } });

    for (const object of createdObjectVersions) {
      await storage.deleteObject(undefined, object.objectKey, object.versionId);
    }

    await prisma.$disconnect();
  });

  it('scans exact, missing, legacy, contract, normalized, and operational cases locally', async () => {
    const tenant = await prisma.tenant.findFirst({ select: { id: true } });
    if (!tenant) {
      throw new Error('Local integration requires at least one local tenant');
    }

    const prefix = `_phase3a4_db_to_storage_test/${randomUUID()}`;
    const exactKey = `${prefix}/exact.bin`;
    const legacyKey = `${prefix}/legacy.bin`;
    const normalizedKey = `${prefix}/normalized.json`;
    const operationalKey = `${prefix}/operational.bin`;
    const missingKey = `${prefix}/missing.bin`;

    const uploadFixture = async (objectKey: string, content: string): Promise<string> => {
      const result = await storage.uploadBuffer(undefined, objectKey, Buffer.from(content, 'utf8'));
      if (!result.versionId) {
        throw new Error(`Local MinIO did not return a VersionId for ${objectKey}`);
      }
      createdObjectVersions.push({ objectKey, versionId: result.versionId });
      return result.versionId;
    };

    const exactVersionId = await uploadFixture(exactKey, 'exact');
    const legacyVersionId = await uploadFixture(legacyKey, 'legacy');
    const normalizedVersionId = await uploadFixture(normalizedKey, '{}');
    const operationalVersionId = await uploadFixture(operationalKey, 'operational');
    const missingVersionId = await uploadFixture(missingKey, 'missing');
    await storage.deleteObject(undefined, missingKey, missingVersionId);
    const missingObjectIndex = createdObjectVersions.findIndex((object) => object.objectKey === missingKey);
    if (missingObjectIndex >= 0) {
      createdObjectVersions.splice(missingObjectIndex, 1);
    }

    const exactFile = await prisma.file.create({
      data: {
        tenantId: tenant.id,
        bucket: storage.getDefaultBucket(),
        objectKey: exactKey,
        objectVersionId: exactVersionId,
        originalName: 'exact.bin',
        mimeType: 'application/octet-stream',
        size: 5,
      },
      select: { id: true },
    });
    createdFileIds.push(exactFile.id);

    const missingFile = await prisma.file.create({
      data: {
        tenantId: tenant.id,
        bucket: storage.getDefaultBucket(),
        objectKey: missingKey,
        objectVersionId: missingVersionId,
        originalName: 'missing.bin',
        mimeType: 'application/octet-stream',
        size: 7,
      },
      select: { id: true },
    });
    createdFileIds.push(missingFile.id);

    const legacyFile = await prisma.file.create({
      data: {
        tenantId: tenant.id,
        bucket: storage.getDefaultBucket(),
        objectKey: legacyKey,
        objectVersionId: null,
        originalName: 'legacy.bin',
        mimeType: 'application/octet-stream',
        size: 6,
      },
      select: { id: true },
    });
    createdFileIds.push(legacyFile.id);

    const normalizedJob = await prisma.importJob.create({
      data: {
        tenantId: tenant.id,
        type: 'INITIAL_ONBOARDING',
        status: 'READY',
        schemaVersion: 'v1',
        previewVersion: 4,
        fileName: 'normalized.xlsx',
        fileSize: 5,
        fileMimeType: 'application/octet-stream',
        fileHash: `${prefix}-normalized`,
        originalObjectKey: exactKey,
        originalObjectVersionId: exactVersionId,
        normalizedObjectKey: normalizedKey,
        normalizedObjectVersionId: normalizedVersionId,
        canConfirm: true,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      select: { id: true },
    });
    createdImportJobIds.push(normalizedJob.id);

    const contractJob = await prisma.importJob.create({
      data: {
        tenantId: tenant.id,
        type: 'INITIAL_ONBOARDING',
        status: 'FAILED',
        schemaVersion: 'v1',
        previewVersion: 4,
        fileName: 'contract.xlsx',
        fileSize: 5,
        fileMimeType: 'application/octet-stream',
        fileHash: `${prefix}-contract`,
        originalObjectKey: `${prefix}/contract.xlsx`,
        originalObjectVersionId: null,
        normalizedObjectKey: null,
        normalizedObjectVersionId: null,
        canConfirm: false,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      select: { id: true },
    });
    createdImportJobIds.push(contractJob.id);

    const operationalJob = await prisma.importJob.create({
      data: {
        tenantId: tenant.id,
        type: 'INITIAL_ONBOARDING',
        status: 'READY',
        schemaVersion: 'v1',
        previewVersion: 4,
        fileName: 'operational.xlsx',
        fileSize: 11,
        fileMimeType: 'application/octet-stream',
        fileHash: `${prefix}-operational`,
        originalObjectKey: operationalKey,
        originalObjectVersionId: operationalVersionId,
        normalizedObjectKey: null,
        normalizedObjectVersionId: null,
        canConfirm: false,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      select: { id: true },
    });
    createdImportJobIds.push(operationalJob.id);

    const statCalls: Array<{ readonly objectKey: string; readonly versionId?: string }> = [];
    const scannerStorage: StorageStatClient = {
      getDefaultBucket: () => storage.getDefaultBucket(),
      statObject: async (bucket, objectKey, versionId) => {
        statCalls.push({ objectKey, ...(versionId ? { versionId } : {}) });
        if (objectKey === operationalKey) {
          throw { statusCode: 500 };
        }
        return storage.statObject(bucket, objectKey, versionId);
      },
      isNotFoundError: (error) => storage.isNotFoundError(error),
    };

    const receipt = await new DbToStorageScanner(
      new PrismaDbToStorageDatabase(prisma),
      scannerStorage,
      { batchSize: 2, maxFindings: 20 },
    ).scan();

    expect(receipt.consistencyModel).toBe('MOVING_WINDOW');
    expect(receipt.storageObservationCounts.EXACT_PRESENT).toBeGreaterThanOrEqual(3);
    expect(receipt.storageObservationCounts.EXACT_MISSING).toBeGreaterThanOrEqual(1);
    expect(receipt.storageObservationCounts.CURRENT_PRESENT).toBeGreaterThanOrEqual(1);
    expect(receipt.classificationCounts.CONTRACT_VIOLATION).toBeGreaterThanOrEqual(1);
    expect(receipt.storageObservationCounts.OPERATIONAL_ERROR).toBeGreaterThanOrEqual(1);
    expect(statCalls.some((call) => call.objectKey === `${prefix}/contract.xlsx`)).toBe(false);
    expect(receipt.scanStatus).toBe('INCOMPLETE_OPERATIONAL_ERROR');
  });
});
