import { randomUUID } from 'node:crypto';
import { ConfigService } from '../config/config.service';
import { loadConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../storage/minio.service';
import { ResidentAccessService } from '../resident-access/resident-access.service';
import { DocumentsService } from './documents.service';
import { DocumentsValidators } from './documents.validators';

const runLocalIntegration = process.env.RUN_LOCAL_DOCUMENT_DELETE_INTEGRATION === '1';
const localDescribe = runLocalIntegration ? describe : describe.skip;

interface CreatedObjectVersion {
  readonly objectKey: string;
  readonly versionId: string;
}

localDescribe('Documents exact-delete local integration', () => {
  let prisma: PrismaService;
  let storage: MinioService;
  let service: DocumentsService;
  const createdObjectVersions: CreatedObjectVersion[] = [];
  const createdDocumentIds: string[] = [];
  const createdFileIds: string[] = [];

  beforeAll(async () => {
    const config = new ConfigService(loadConfig());
    prisma = new PrismaService();
    storage = new MinioService(config);
    await prisma.$connect();

    const residentAccess = {
      shouldEnforce: () => false,
    } as unknown as ResidentAccessService;
    const validators = new DocumentsValidators(prisma, residentAccess);
    service = new DocumentsService(
      prisma,
      validators,
      storage,
      { createNotification: async () => undefined } as never,
      { createLog: async () => undefined } as never,
      residentAccess,
    );
  });

  afterAll(async () => {
    if (!prisma || !storage) {
      return;
    }

    await prisma.document.deleteMany({ where: { id: { in: createdDocumentIds } } });
    await prisma.file.deleteMany({ where: { id: { in: createdFileIds } } });

    for (const object of createdObjectVersions) {
      try {
        await storage.deleteObject(undefined, object.objectKey, object.versionId);
      } catch (error: unknown) {
        if (!storage.isNotFoundError(error)) {
          throw error;
        }
      }
    }

    await prisma.$disconnect();
  });

  it('deletes only the referenced version and preserves the current successor', async () => {
    const tenant = await prisma.tenant.findFirst({ select: { id: true } });
    if (!tenant) {
      throw new Error('Local integration requires at least one local tenant');
    }

    const objectKey = `tenant-${tenant.id}/documents/${randomUUID()}.pdf`;
    const upload = async (content: string): Promise<string> => {
      const result = await storage.uploadBuffer(undefined, objectKey, Buffer.from(content, 'utf8'));
      if (!result.versionId) {
        throw new Error(`Local MinIO did not return a VersionId for ${objectKey}`);
      }
      createdObjectVersions.push({ objectKey, versionId: result.versionId });
      return result.versionId;
    };

    const version1 = await upload('version-one');
    const version2 = await upload('version-two');
    const file = await prisma.file.create({
      data: {
        tenantId: tenant.id,
        bucket: storage.getDefaultBucket(),
        objectKey,
        objectVersionId: version1,
        originalName: 'file.pdf',
        mimeType: 'application/pdf',
        size: 11,
      },
      select: { id: true },
    });
    createdFileIds.push(file.id);
    const document = await prisma.document.create({
      data: {
        tenantId: tenant.id,
        fileId: file.id,
        title: 'Exact delete integration document',
        category: 'OTHER',
        visibility: 'TENANT_ADMINS',
      },
      select: { id: true },
    });
    createdDocumentIds.push(document.id);

    await service.deleteDocument(tenant.id, document.id, 'local-integration-admin', ['TENANT_ADMIN']);
    await flushStorageCleanup();

    expect(await prisma.document.findUnique({ where: { id: document.id } })).toBeNull();
    expect(await prisma.file.findUnique({ where: { id: file.id } })).toBeNull();
    await expectMissingVersion(objectKey, version1);
    await expectPresentVersion(objectKey, version2, true);
  });

  it('deletes legacy metadata while preserving its storage object', async () => {
    const tenant = await prisma.tenant.findFirst({ select: { id: true } });
    if (!tenant) {
      throw new Error('Local integration requires at least one local tenant');
    }

    const objectKey = `tenant-${tenant.id}/documents/${randomUUID()}-legacy.pdf`;
    const result = await storage.uploadBuffer(undefined, objectKey, Buffer.from('legacy', 'utf8'));
    if (!result.versionId) {
      throw new Error(`Local MinIO did not return a VersionId for ${objectKey}`);
    }
    createdObjectVersions.push({ objectKey, versionId: result.versionId });

    const file = await prisma.file.create({
      data: {
        tenantId: tenant.id,
        bucket: storage.getDefaultBucket(),
        objectKey,
        objectVersionId: null,
        originalName: 'legacy.pdf',
        mimeType: 'application/pdf',
        size: 6,
      },
      select: { id: true },
    });
    createdFileIds.push(file.id);
    const document = await prisma.document.create({
      data: {
        tenantId: tenant.id,
        fileId: file.id,
        title: 'Legacy delete integration document',
        category: 'OTHER',
        visibility: 'TENANT_ADMINS',
      },
      select: { id: true },
    });
    createdDocumentIds.push(document.id);

    await service.deleteDocument(tenant.id, document.id, 'local-integration-admin', ['TENANT_ADMIN']);
    await flushStorageCleanup();

    expect(await prisma.document.findUnique({ where: { id: document.id } })).toBeNull();
    expect(await prisma.file.findUnique({ where: { id: file.id } })).toBeNull();
    await expectPresentVersion(objectKey, result.versionId, true);
  });

  async function expectMissingVersion(objectKey: string, versionId: string): Promise<void> {
    try {
      await storage.statObject(undefined, objectKey, versionId);
      throw new Error(`Expected storage version to be missing: ${objectKey}/${versionId}`);
    } catch (error: unknown) {
      expect(storage.isNotFoundError(error)).toBe(true);
    }
  }

  async function expectPresentVersion(objectKey: string, versionId: string, expectCurrent: boolean): Promise<void> {
    const stat = await storage.statObject(undefined, objectKey, versionId);
    expect(stat.versionId).toBe(versionId);

    if (expectCurrent) {
      const current = await storage.statObject(undefined, objectKey);
      expect(current.versionId).toBe(versionId);
    }
  }

  async function flushStorageCleanup(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
});
