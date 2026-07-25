import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import { DocumentsService } from './documents.service';
import { DocumentsValidators } from './documents.validators';
import { ResidentAccessService } from '../resident-access/resident-access.service';
import { Prisma } from '@prisma/client';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const DEFAULT_BUCKET = 'buildingos-test';

function createPrismaKnownRequestError(code: string): Prisma.PrismaClientKnownRequestError {
  const error = new Error('Prisma known request error');
  Object.assign(error, { code });
  Object.setPrototypeOf(error, Prisma.PrismaClientKnownRequestError.prototype);
  return error as Prisma.PrismaClientKnownRequestError;
}

describe('DocumentsService', () => {
  const prisma = {
    $transaction: jest.fn(),
    document: {
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    file: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    tenant: {
      findUnique: jest.fn(),
    },
  };
  const validators = {
    validateDocumentScope: jest.fn(),
    validateBuildingBelongsToTenant: jest.fn(),
    validateUnitBelongsToBuilding: jest.fn(),
    validateResidentDocumentAccess: jest.fn(),
    canAccessDocument: jest.fn(),
  } as unknown as jest.Mocked<DocumentsValidators>;
  const minio = {
    getDefaultBucket: jest.fn(() => DEFAULT_BUCKET),
    deleteObject: jest.fn(),
    presignUpload: jest.fn(),
    presignDownload: jest.fn(),
    objectExists: jest.fn(),
    statObject: jest.fn(),
    getObjectStream: jest.fn(),
  };
  const notifications = {
    createNotification: jest.fn(),
  };
  const audit = {
    createLog: jest.fn(),
  };
  const residentAccess = {
    shouldEnforce: jest.fn(),
  } as unknown as jest.Mocked<ResidentAccessService>;
  const configService = {
    getValue: jest.fn((key: string) => {
      if (key === 'uploadMaxBytes') return MAX_UPLOAD_BYTES;
      return undefined;
    }),
  };
  const service = new DocumentsService(
    prisma as never,
    validators,
    minio as never,
    notifications as never,
    audit as never,
    residentAccess,
    configService as never,
  );

  const uploadFile = {
    bucket: DEFAULT_BUCKET,
    objectKey: 'tenant-tenant-1/documents/proof.pdf',
    originalName: 'proof.pdf',
    mimeType: 'application/pdf',
    size: 1024,
    checksum: 'checksum-123',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    minio.getDefaultBucket.mockReturnValue(DEFAULT_BUCKET);
    prisma.$transaction.mockImplementation(async (callback: (tx: never) => Promise<unknown>) => {
      const tx = {
        file: prisma.file,
        document: prisma.document,
      } as never;

      return callback(tx);
    });
    validators.validateDocumentScope.mockReturnValue(undefined);
    validators.validateBuildingBelongsToTenant.mockResolvedValue(undefined);
    validators.validateUnitBelongsToBuilding.mockResolvedValue(undefined);
    validators.canAccessDocument.mockReturnValue(true);
    validators.validateResidentDocumentAccess.mockResolvedValue(undefined);
    residentAccess.shouldEnforce.mockReturnValue(false);
    prisma.file.findFirst.mockResolvedValue(null);
    prisma.document.findFirst.mockResolvedValue({
      id: 'document-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      unitId: 'unit-1',
      visibility: 'RESIDENTS',
      title: 'Receipt',
      category: 'RECEIPT',
      createdByMembership: { userId: 'admin-1' },
      file: { bucket: 'tenant-legacy-bucket', objectKey: 'receipt.pdf', originalName: 'receipt.pdf', mimeType: 'application/pdf' },
    } as never);
  });

  it('rejects presign requests that exceed the backend upload limit', async () => {
    await expect(
      service.presignUpload('tenant-1', 'proof.pdf', 'application/pdf', MAX_UPLOAD_BYTES + 1),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);

    expect(minio.presignUpload).not.toHaveBeenCalled();
  });

  it('uses the configured bucket for presign uploads', async () => {
    minio.presignUpload.mockResolvedValue('https://upload.example/proof.pdf');

    const result = await service.presignUpload('tenant-1', 'proof.pdf', 'application/pdf', 1024);

    expect(minio.getDefaultBucket).toHaveBeenCalled();
    expect(minio.presignUpload).toHaveBeenCalledWith(
      DEFAULT_BUCKET,
      expect.stringMatching(/^tenant-tenant-1\/documents\//),
      86400,
    );
    expect(result.bucket).toBe(DEFAULT_BUCKET);
  });

  it('preserves double dots inside generated filenames and accepts the generated key', async () => {
    minio.presignUpload.mockResolvedValue('https://upload.example/expensas.pdf');
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: 1024 } as never);
    prisma.file.create.mockResolvedValueOnce({ id: 'file-1' } as never);
    prisma.document.create.mockResolvedValueOnce({
      id: 'document-1',
      tenantId: 'tenant-1',
      title: 'Receipt',
      category: 'RECEIPT',
      visibility: 'TENANT_ADMINS',
      buildingId: 'building-1',
      unitId: 'unit-1',
      createdByMembership: { user: { id: 'admin-1', name: 'Admin' } },
      file: { bucket: DEFAULT_BUCKET, objectKey: 'tenant-tenant-1/documents/generated-expensas..julio.pdf' },
    } as never);

    const presignResult = await service.presignUpload('tenant-1', 'expensas..julio.pdf', 'application/pdf', 1024);
    expect(presignResult.objectKey).toContain('expensas..julio.pdf');

    const result = await service.createDocument('tenant-1', 'membership-1', {
      title: 'Receipt',
      category: 'RECEIPT',
      visibility: 'TENANT_ADMINS',
      file: {
        bucket: DEFAULT_BUCKET,
        objectKey: 'tenant-tenant-1/documents/generated-expensas..julio.pdf',
        originalName: 'expensas..julio.pdf',
        mimeType: 'application/pdf',
        size: 1024,
      },
      buildingId: 'building-1',
      unitId: 'unit-1',
    });

    expect(minio.deleteObject).not.toHaveBeenCalled();
    expect(result.file.objectKey).toContain('expensas..julio.pdf');
  });

  it('rejects empty uploads before creating the document record', async () => {
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: 0 } as never);

    await expect(service.createDocument('tenant-1', 'membership-1', {
      title: 'Receipt',
      category: 'RECEIPT',
      visibility: 'RESIDENTS',
      file: uploadFile,
      buildingId: 'building-1',
      unitId: 'unit-1',
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(minio.deleteObject).toHaveBeenCalledWith(DEFAULT_BUCKET, uploadFile.objectKey);
    expect(prisma.file.create).not.toHaveBeenCalled();
    expect(prisma.document.create).not.toHaveBeenCalled();
  });

  it('rejects object keys from another tenant before touching storage', async () => {
    await expect(service.createDocument('tenant-1', 'membership-1', {
      title: 'Receipt',
      category: 'RECEIPT',
      visibility: 'RESIDENTS',
      file: { ...uploadFile, objectKey: 'tenant-tenant-2/documents/proof.pdf' },
      buildingId: 'building-1',
      unitId: 'unit-1',
    })).rejects.toBeInstanceOf(ForbiddenException);

    expect(minio.objectExists).not.toHaveBeenCalled();
    expect(minio.statObject).not.toHaveBeenCalled();
    expect(minio.deleteObject).not.toHaveBeenCalled();
    expect(prisma.file.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    'tenant-tenant-1/documents/../tenant-tenant-2/proof.pdf',
    'tenant-tenant-1/documents/./proof.pdf',
    'tenant-tenant-1/documents\\proof.pdf',
    'tenant-tenant-1/documents//proof.pdf',
    'tenant-tenant-1/documents/proof\0.pdf',
  ])('rejects invalid object keys without touching storage: %s', async (objectKey) => {
    await expect(service.createDocument('tenant-1', 'membership-1', {
      title: 'Receipt',
      category: 'RECEIPT',
      visibility: 'RESIDENTS',
      file: { ...uploadFile, objectKey },
      buildingId: 'building-1',
      unitId: 'unit-1',
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(minio.objectExists).not.toHaveBeenCalled();
    expect(minio.statObject).not.toHaveBeenCalled();
    expect(minio.deleteObject).not.toHaveBeenCalled();
    expect(prisma.file.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a reused object key before cleanup can delete it', async () => {
    prisma.file.findFirst.mockResolvedValueOnce({ id: 'file-1' } as never);

    await expect(service.createDocument('tenant-1', 'membership-1', {
      title: 'Receipt',
      category: 'RECEIPT',
      visibility: 'RESIDENTS',
      file: uploadFile,
      buildingId: 'building-1',
      unitId: 'unit-1',
    })).rejects.toBeInstanceOf(ConflictException);

    expect(minio.objectExists).not.toHaveBeenCalled();
    expect(minio.statObject).not.toHaveBeenCalled();
    expect(minio.deleteObject).not.toHaveBeenCalled();
    expect(prisma.file.create).not.toHaveBeenCalled();
    expect(prisma.document.create).not.toHaveBeenCalled();
  });

  it('preserves the uploaded object when a concurrent create already persisted the file row', async () => {
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: 1024 } as never);
    prisma.file.create.mockRejectedValueOnce(createPrismaKnownRequestError('P2002'));
    prisma.file.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'file-1' } as never);

    await expect(service.createDocument('tenant-1', 'membership-1', {
      title: 'Receipt',
      category: 'RECEIPT',
      visibility: 'RESIDENTS',
      file: uploadFile,
      buildingId: 'building-1',
      unitId: 'unit-1',
    })).rejects.toMatchObject({ code: 'P2002' });

    expect(minio.deleteObject).not.toHaveBeenCalled();
    expect(prisma.document.create).not.toHaveBeenCalled();
  });

  it('rejects uploaded files that exceed the backend limit using the real storage size', async () => {
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: MAX_UPLOAD_BYTES + 1 } as never);

    await expect(service.createDocument('tenant-1', 'membership-1', {
      title: 'Receipt',
      category: 'RECEIPT',
      visibility: 'RESIDENTS',
      file: uploadFile,
      buildingId: 'building-1',
      unitId: 'unit-1',
    })).rejects.toBeInstanceOf(PayloadTooLargeException);

    expect(minio.deleteObject).toHaveBeenCalledWith(DEFAULT_BUCKET, uploadFile.objectKey);
    expect(prisma.file.create).not.toHaveBeenCalled();
    expect(prisma.document.create).not.toHaveBeenCalled();
  });

  it('persists uploaded files using the configured bucket', async () => {
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: 1024 } as never);
    prisma.file.create.mockResolvedValueOnce({ id: 'file-1' } as never);
    prisma.document.create.mockResolvedValueOnce({
      id: 'document-1',
      tenantId: 'tenant-1',
      title: 'Receipt',
      category: 'RECEIPT',
      visibility: 'TENANT_ADMINS',
      buildingId: 'building-1',
      unitId: 'unit-1',
      createdByMembership: { user: { id: 'admin-1', name: 'Admin' } },
      file: { bucket: DEFAULT_BUCKET, objectKey: uploadFile.objectKey },
    } as never);

    const result = await service.createDocument('tenant-1', 'membership-1', {
      title: 'Receipt',
      category: 'RECEIPT',
      visibility: 'TENANT_ADMINS',
      file: uploadFile,
      buildingId: 'building-1',
      unitId: 'unit-1',
    });

    expect(minio.objectExists).toHaveBeenCalledWith(DEFAULT_BUCKET, uploadFile.objectKey);
    expect(minio.statObject).toHaveBeenCalledWith(DEFAULT_BUCKET, uploadFile.objectKey);
    expect(prisma.file.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        bucket: DEFAULT_BUCKET,
        objectKey: uploadFile.objectKey,
      }),
    }));
    expect(result.file.bucket).toBe(DEFAULT_BUCKET);
  });

  it('cleans up the uploaded object if the document row cannot be persisted', async () => {
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: 1024 } as never);
    prisma.file.create.mockResolvedValueOnce({ id: 'file-1' } as never);
    prisma.document.create.mockRejectedValueOnce(new Error('DB down'));

    await expect(service.createDocument('tenant-1', 'membership-1', {
      title: 'Receipt',
      category: 'RECEIPT',
      visibility: 'RESIDENTS',
      file: uploadFile,
      buildingId: 'building-1',
      unitId: 'unit-1',
    })).rejects.toThrow('DB down');

    expect(prisma.file.create).toHaveBeenCalled();
    expect(prisma.document.create).toHaveBeenCalled();
    expect(minio.deleteObject).toHaveBeenCalledWith(DEFAULT_BUCKET, uploadFile.objectKey);
  });

  it('rejects unsafe MIME types and cleans up the uploaded object', async () => {
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: 1024 } as never);

    await expect(service.createDocument('tenant-1', 'membership-1', {
      title: 'Receipt',
      category: 'RECEIPT',
      visibility: 'RESIDENTS',
      file: { ...uploadFile, mimeType: 'application/x-msdownload' },
      buildingId: 'building-1',
      unitId: 'unit-1',
    })).rejects.toThrow('File type not allowed');

    expect(minio.deleteObject).toHaveBeenCalledWith(DEFAULT_BUCKET, uploadFile.objectKey);
    expect(prisma.file.create).not.toHaveBeenCalled();
    expect(prisma.document.create).not.toHaveBeenCalled();
  });

  it('returns a presigned download URL after validating resident receipt access', async () => {
    minio.presignDownload.mockResolvedValue('https://download.example/receipt.pdf');

    const result = await service.getDownloadUrl(
      'tenant-1',
      'document-1',
      'resident-1',
      ['RESIDENT'],
      false,
    );

    expect(validators.validateResidentDocumentAccess).toHaveBeenCalledWith(
      'tenant-1',
      'resident-1',
      'building-1',
      'unit-1',
      'RESIDENTS',
      false,
    );
    expect(minio.presignDownload).toHaveBeenCalledWith('tenant-legacy-bucket', 'receipt.pdf', 86400);
    expect(result).toEqual({
      url: 'https://download.example/receipt.pdf',
      expiresAt: expect.any(Date),
    });
  });

  it('streams a protected document download using the persisted bucket and sanitized filename', async () => {
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: 2048 } as never);
    minio.getObjectStream.mockResolvedValue(Readable.from(['pdf-bytes']) as never);

    const result = await service.getDocumentContent(
      'tenant-1',
      'document-1',
      'resident-1',
      ['RESIDENT'],
      false,
    );

    expect(minio.objectExists).toHaveBeenCalledWith('tenant-legacy-bucket', 'receipt.pdf');
    expect(minio.statObject).toHaveBeenCalledWith('tenant-legacy-bucket', 'receipt.pdf');
    expect(minio.getObjectStream).toHaveBeenCalledWith('tenant-legacy-bucket', 'receipt.pdf');
    expect(result.contentType).toBe('application/pdf');
    expect(result.contentLength).toBe(2048);
    expect(result.fileName).toBe('receipt.pdf');
    expect(result.disposition).toBe('inline');
    expect(result.stream.readable).toBe(true);
  });

  it('rejects downloads when the file no longer exists in MinIO', async () => {
    minio.objectExists.mockResolvedValue(false);

    await expect(
      service.getDocumentContent('tenant-1', 'document-1', 'resident-1', ['RESIDENT'], false),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(minio.statObject).not.toHaveBeenCalled();
    expect(minio.getObjectStream).not.toHaveBeenCalled();
  });

  it('sanitizes malicious download filenames and uses attachment for non-inline types', async () => {
    prisma.document.findFirst.mockResolvedValue({
      id: 'document-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      unitId: 'unit-1',
      visibility: 'RESIDENTS',
      title: 'Receipt',
      category: 'RECEIPT',
      createdByMembership: { userId: 'admin-1' },
      file: {
        bucket: 'tenant-legacy-bucket',
        objectKey: 'receipt.bin',
        originalName: 'receipt"\r\n.pdf',
        mimeType: 'application/octet-stream',
      },
    } as never);
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: 1024 } as never);
    minio.getObjectStream.mockResolvedValue(Readable.from(['binary']) as never);

    const result = await service.getDocumentContent(
      'tenant-1',
      'document-1',
      'resident-1',
      ['RESIDENT'],
      false,
    );

    expect(result.fileName).toBe('receipt_.pdf');
    expect(result.disposition).toBe('attachment');
  });

  it('blocks receipt downloads for residents without active access to the unit', async () => {
    validators.validateResidentDocumentAccess.mockRejectedValue(new NotFoundException('Document not found or does not belong to you'));

    await expect(
      service.getDownloadUrl('tenant-1', 'document-1', 'resident-1', ['RESIDENT'], false),
    ).rejects.toThrow(NotFoundException);

    expect(minio.presignDownload).not.toHaveBeenCalled();
  });

  it('requires a current occupancy before a resident creator can update a document', async () => {
    prisma.document.findFirst.mockResolvedValue({
      id: 'document-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      unitId: 'unit-1',
      visibility: 'PRIVATE',
      title: 'Receipt',
      category: 'RECEIPT',
      createdByMembership: { userId: 'resident-1' },
      file: { bucket: 'tenant-1', objectKey: 'receipt.pdf' },
    } as never);
    residentAccess.shouldEnforce.mockReturnValue(true);
    validators.validateResidentDocumentAccess.mockRejectedValue(
      new Error('Document not found or does not belong to you'),
    );

    await expect(service.updateDocument(
      'tenant-1',
      'document-1',
      'resident-1',
      ['RESIDENT'],
      { title: 'Renamed receipt' },
    )).rejects.toThrow('Document not found or does not belong to you');

    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it('requires a current occupancy before a resident creator can delete a document', async () => {
    prisma.document.findFirst.mockResolvedValue({
      id: 'document-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      unitId: 'unit-1',
      visibility: 'PRIVATE',
      title: 'Receipt',
      category: 'RECEIPT',
      createdByMembership: { userId: 'resident-1' },
      file: { bucket: 'tenant-1', objectKey: 'receipt.pdf' },
    } as never);
    residentAccess.shouldEnforce.mockReturnValue(true);
    validators.validateResidentDocumentAccess.mockRejectedValue(
      new Error('Document not found or does not belong to you'),
    );

    await expect(service.deleteDocument(
      'tenant-1',
      'document-1',
      'resident-1',
      ['RESIDENT'],
    )).rejects.toThrow('Document not found or does not belong to you');

    expect(prisma.document.delete).not.toHaveBeenCalled();
  });
});
