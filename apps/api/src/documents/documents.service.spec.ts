import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import { DocumentsService } from './documents.service';
import { DocumentUploadPurpose } from './dto/presign-upload.dto';
import { DocumentsValidators } from './documents.validators';
import { ResidentAccessService } from '../resident-access/resident-access.service';
import { Prisma } from '@prisma/client';
import { PAYMENT_LINKED_DOCUMENT_CONFLICT_MESSAGE } from '../common/payment-linked-document-lock';

const PAYMENT_PROOF_MAX_BYTES = 10 * 1024 * 1024;
const GENERAL_DOCUMENT_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_BUCKET = 'buildingos-test';

function createPrismaKnownRequestError(code: string): Prisma.PrismaClientKnownRequestError {
  const error = new Error('Prisma known request error');
  Object.assign(error, { code });
  Object.setPrototypeOf(error, Prisma.PrismaClientKnownRequestError.prototype);
  return error as Prisma.PrismaClientKnownRequestError;
}

function expectNoPasswordHashDeep(value: unknown): void {
  const seen = new Set<unknown>();
  const visit = (current: unknown): void => {
    if (current == null || typeof current !== 'object' || seen.has(current)) {
      return;
    }

    seen.add(current);
    expect(Object.prototype.hasOwnProperty.call(current, 'passwordHash')).toBe(false);

    for (const nested of Object.values(current as Record<string, unknown>)) {
      visit(nested);
    }
  };

  visit(value);
  expect(JSON.stringify(value)).not.toContain('passwordHash');
}

describe('DocumentsService', () => {
  let transactionQueryRawMock: jest.Mock;
  const prisma = {
    $transaction: jest.fn(),
    document: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    file: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    payment: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    tenant: {
      findUnique: jest.fn(),
    },
    unitOccupant: {
      findMany: jest.fn(),
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
  const service = new DocumentsService(
    prisma as never,
    validators,
    minio as never,
    notifications as never,
    audit as never,
    residentAccess,
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
    transactionQueryRawMock = jest.fn().mockResolvedValue([]);
    prisma.$transaction.mockImplementation(async (callback: (tx: never) => Promise<unknown>) => {
      const tx = {
        file: prisma.file,
        document: prisma.document,
        payment: prisma.payment,
        $queryRaw: transactionQueryRawMock,
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
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.unitOccupant.findMany.mockResolvedValue([]);
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

  it.each([9, 10, 50, 100])('allows general document presign requests at %i MiB', async (sizeInMiB) => {
    minio.presignUpload.mockResolvedValue('https://upload.example/general.pdf');

    await expect(
      service.presignUpload(
        'tenant-1',
        'general.pdf',
        'application/pdf',
        sizeInMiB * 1024 * 1024,
      ),
    ).resolves.toEqual(expect.objectContaining({ objectKey: expect.stringContaining('/documents/') }));
  });

  it.each([
    'text/plain',
    'text/plain; charset=UTF-8',
    'text/plain;charset=utf-8',
    'TEXT/PLAIN; CHARSET=UTF-8',
  ])('accepts the approved text/plain MIME representation %s', async (mimeType) => {
    minio.presignUpload.mockResolvedValue('https://upload.example/text.txt');

    await expect(
      service.presignUpload('tenant-1', 'notes.txt', mimeType, 1024),
    ).resolves.toEqual(expect.objectContaining({ objectKey: expect.stringContaining('/documents/') }));
  });

  it('rejects general document presign requests over 100 MiB with a 100 MB message', async () => {
    await expect(
      service.presignUpload(
        'tenant-1',
        'general.pdf',
        'application/pdf',
        GENERAL_DOCUMENT_MAX_BYTES + 1,
      ),
    ).rejects.toThrow('100 MB');

    expect(minio.presignUpload).not.toHaveBeenCalled();
  });

  it.each([9, 10])('allows payment proof presign requests at %i MiB', async (sizeInMiB) => {
    minio.presignUpload.mockResolvedValue('https://upload.example/proof.pdf');

    await expect(
      service.presignUpload(
        'tenant-1',
        'proof.pdf',
        'application/pdf',
        sizeInMiB * 1024 * 1024,
        DocumentUploadPurpose.PAYMENT_PROOF,
      ),
    ).resolves.toEqual(expect.objectContaining({ objectKey: expect.stringContaining('/payment-proofs/') }));
  });

  it('rejects payment proof presign requests over 10 MiB with a 10 MB message', async () => {
    await expect(
      service.presignUpload(
        'tenant-1',
        'proof.pdf',
        'application/pdf',
        PAYMENT_PROOF_MAX_BYTES + 1,
        DocumentUploadPurpose.PAYMENT_PROOF,
      ),
    ).rejects.toThrow('10 MB');

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

  it('sanitizes createdByMembership.user in createDocument responses', async () => {
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: 1024 } as never);
    prisma.file.create.mockResolvedValueOnce({ id: 'file-create' } as never);
    prisma.document.create.mockResolvedValueOnce({
      id: 'document-create',
      tenantId: 'tenant-1',
      title: 'Receipt',
      category: 'RECEIPT',
      visibility: 'RESIDENTS',
      buildingId: 'building-1',
      unitId: 'unit-1',
      createdByMembership: {
        id: 'membership-1',
        userId: 'user-1',
        user: {
          id: 'user-1',
          email: 'resident@example.com',
          name: 'Resident One',
          passwordHash: 'secret-create-hash',
        },
      },
      file: { bucket: DEFAULT_BUCKET, objectKey: uploadFile.objectKey },
    } as never);

    const result = await service.createDocument('tenant-1', 'membership-1', {
      title: 'Receipt',
      category: 'RECEIPT',
      visibility: 'RESIDENTS',
      file: uploadFile,
      buildingId: 'building-1',
      unitId: 'unit-1',
    });

    expect(prisma.document.create).toHaveBeenCalledWith(expect.objectContaining({
      include: {
        file: true,
        createdByMembership: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        },
      },
    }));
    expect(result.createdByMembership?.user).toEqual({
      id: 'user-1',
      email: 'resident@example.com',
      name: 'Resident One',
    });
    expectNoPasswordHashDeep(result);
  });

  it('sanitizes createdByMembership.user in listDocuments responses', async () => {
    prisma.document.findMany.mockResolvedValueOnce([
      {
        id: 'document-list',
        tenantId: 'tenant-1',
        fileId: 'file-1',
        title: 'Reglamento',
        category: 'OTHER',
        visibility: 'RESIDENTS',
        buildingId: 'building-1',
        unitId: 'unit-1',
        createdByMembership: {
          id: 'membership-1',
          userId: 'user-1',
          user: {
            id: 'user-1',
            email: 'resident@example.com',
            name: 'Resident One',
            passwordHash: 'secret-list-hash',
          },
        },
        file: { bucket: DEFAULT_BUCKET, objectKey: 'tenant-tenant-1/documents/reglamento.pdf', originalName: 'reglamento.pdf', mimeType: 'application/pdf' },
      },
    ] as never);
    prisma.payment.findMany.mockResolvedValueOnce([]);

    const result = await service.listDocuments('tenant-1', 'resident-1', ['RESIDENT'], false);

    expect(prisma.document.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: {
        file: true,
        createdByMembership: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        },
      },
    }));
    expect(result[0].createdByMembership?.user).toEqual({
      id: 'user-1',
      email: 'resident@example.com',
      name: 'Resident One',
    });
    expectNoPasswordHashDeep(result);
  });

  it('sanitizes createdByMembership.user in getDocument responses', async () => {
    prisma.document.findFirst.mockResolvedValueOnce({
      id: 'document-detail',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      unitId: 'unit-1',
      visibility: 'RESIDENTS',
      title: 'Receipt',
      category: 'RECEIPT',
      createdByMembership: {
        id: 'membership-1',
        userId: 'user-1',
        user: {
          id: 'user-1',
          email: 'resident@example.com',
          name: 'Resident One',
          passwordHash: 'secret-detail-hash',
        },
      },
      file: { bucket: 'tenant-legacy-bucket', objectKey: 'receipt.pdf', originalName: 'receipt.pdf', mimeType: 'application/pdf' },
    } as never);

    const result = await service.getDocument('tenant-1', 'document-1', 'resident-1', ['RESIDENT'], false);

    expect(prisma.document.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      include: {
        file: true,
        createdByMembership: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        },
      },
    }));
    expect(result.createdByMembership?.user).toEqual({
      id: 'user-1',
      email: 'resident@example.com',
      name: 'Resident One',
    });
    expectNoPasswordHashDeep(result);
  });

  it('sanitizes createdByMembership.user in updateDocument responses', async () => {
    prisma.document.findFirst.mockResolvedValueOnce({
      id: 'document-update',
      fileId: 'file-update',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      unitId: 'unit-1',
      visibility: 'RESIDENTS',
      title: 'Receipt',
      category: 'RECEIPT',
      createdByMembership: {
        id: 'membership-1',
        userId: 'user-1',
        user: {
          id: 'user-1',
          email: 'resident@example.com',
          name: 'Resident One',
          passwordHash: 'secret-update-hash',
        },
      },
      file: { bucket: 'tenant-legacy-bucket', objectKey: 'receipt.pdf', originalName: 'receipt.pdf', mimeType: 'application/pdf' },
    } as never);
    prisma.document.update.mockResolvedValueOnce({
      id: 'document-update',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      unitId: 'unit-1',
      visibility: 'RESIDENTS',
      title: 'Updated title',
      category: 'RECEIPT',
      createdByMembership: {
        id: 'membership-1',
        userId: 'user-1',
        user: {
          id: 'user-1',
          email: 'resident@example.com',
          name: 'Resident One',
          passwordHash: 'secret-update-hash',
        },
      },
      file: { bucket: 'tenant-legacy-bucket', objectKey: 'receipt.pdf', originalName: 'receipt.pdf', mimeType: 'application/pdf' },
    } as never);

    const result = await service.updateDocument('tenant-1', 'document-1', 'user-1', ['RESIDENT'], {
      title: 'Updated title',
    });

    expect(prisma.document.update).toHaveBeenCalledWith(expect.objectContaining({
      include: {
        file: true,
        createdByMembership: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
              },
            },
          },
        },
      },
    }));
    expect(result.createdByMembership?.user).toEqual({
      id: 'user-1',
      email: 'resident@example.com',
      name: 'Resident One',
    });
    expectNoPasswordHashDeep(result);
    expect(transactionQueryRawMock).toHaveBeenCalledTimes(1);
  });

  it('blocks document updates when the file is linked to a payment proof or receipt', async () => {
    prisma.document.findFirst.mockResolvedValueOnce({
      id: 'document-linked',
      fileId: 'file-linked',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      unitId: 'unit-1',
      visibility: 'RESIDENTS',
      title: 'Receipt',
      category: 'RECEIPT',
      createdByMembership: {
        id: 'membership-1',
        userId: 'user-1',
      },
      file: { bucket: 'tenant-legacy-bucket', objectKey: 'receipt.pdf', originalName: 'receipt.pdf', mimeType: 'application/pdf' },
    } as never);
    prisma.payment.findFirst.mockResolvedValueOnce({ id: 'payment-linked' } as never);

    await expect(service.updateDocument('tenant-1', 'document-linked', 'user-1', ['TENANT_ADMIN'], {
      title: 'Updated title',
    })).rejects.toThrow('El comprobante está asociado a un pago y no puede modificarse.');

    expect(transactionQueryRawMock).toHaveBeenCalledTimes(1);
    expect(prisma.payment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId: 'tenant-1',
        OR: [
          { receiptDocumentId: 'document-linked' },
          { proofFileId: 'file-linked' },
        ],
      },
      select: { id: true },
    }));
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it('does not notify anyone for payment proofs', async () => {
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: 1024 } as never);
    prisma.file.create.mockResolvedValueOnce({ id: 'file-proof' } as never);
    prisma.document.create.mockResolvedValueOnce({
      id: 'document-proof',
      tenantId: 'tenant-1',
      title: 'Pago de julio',
      category: 'RECEIPT',
      visibility: 'RESIDENTS',
      buildingId: 'building-1',
      unitId: 'unit-1',
      createdByMembership: { user: { id: 'resident-1', name: 'Resident' } },
      file: { bucket: DEFAULT_BUCKET, objectKey: 'tenant-tenant-1/payment-proofs/proof.pdf' },
    } as never);
    await service.createDocument('tenant-1', 'membership-1', {
      title: 'Pago de julio',
      category: 'RECEIPT',
      visibility: 'RESIDENTS',
      file: {
        ...uploadFile,
        objectKey: 'tenant-tenant-1/payment-proofs/proof.pdf',
      },
      buildingId: 'building-1',
      unitId: 'unit-1',
    });

    expect(prisma.unitOccupant.findMany).not.toHaveBeenCalled();
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });

  it('deletes unlinked documents normally', async () => {
    prisma.document.findFirst.mockResolvedValueOnce({
      id: 'document-delete',
      fileId: 'file-delete',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      unitId: 'unit-1',
      visibility: 'RESIDENTS',
      title: 'Receipt',
      category: 'RECEIPT',
      createdByMembership: {
        id: 'membership-1',
        userId: 'user-1',
      },
      file: { bucket: 'tenant-delete-bucket', objectKey: 'receipt.pdf', originalName: 'receipt.pdf', mimeType: 'application/pdf' },
    } as never);
    prisma.document.delete.mockResolvedValueOnce({} as never);

    await expect(service.deleteDocument('tenant-1', 'document-delete', 'user-1', ['TENANT_ADMIN'])).resolves.toBeUndefined();

    expect(transactionQueryRawMock).toHaveBeenCalledTimes(1);
    expect(prisma.document.delete).toHaveBeenCalledWith({ where: { id: 'document-delete' } });
    expect(minio.deleteObject).toHaveBeenCalledWith('tenant-delete-bucket', 'receipt.pdf');
  });

  it('blocks document deletes when the file is linked to a payment proof or receipt', async () => {
    prisma.document.findFirst.mockResolvedValueOnce({
      id: 'document-linked-delete',
      fileId: 'file-linked-delete',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      unitId: 'unit-1',
      visibility: 'RESIDENTS',
      title: 'Receipt',
      category: 'RECEIPT',
      createdByMembership: {
        id: 'membership-1',
        userId: 'user-1',
      },
      file: { bucket: 'tenant-legacy-bucket', objectKey: 'receipt.pdf', originalName: 'receipt.pdf', mimeType: 'application/pdf' },
    } as never);
    prisma.payment.findFirst.mockResolvedValueOnce({ id: 'payment-linked-delete' } as never);

    await expect(service.deleteDocument('tenant-1', 'document-linked-delete', 'user-1', ['TENANT_ADMIN'])).rejects.toThrow('El comprobante está asociado a un pago y no puede modificarse.');

    expect(transactionQueryRawMock).toHaveBeenCalledTimes(1);
    expect(prisma.payment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId: 'tenant-1',
        OR: [
          { receiptDocumentId: 'document-linked-delete' },
          { proofFileId: 'file-linked-delete' },
        ],
      },
      select: { id: true },
    }));
    expect(prisma.document.delete).not.toHaveBeenCalled();
    expect(minio.deleteObject).not.toHaveBeenCalled();
  });

  it('excludes the uploading resident from general resident document notifications', async () => {
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: 1024 } as never);
    prisma.file.create.mockResolvedValueOnce({ id: 'file-doc' } as never);
    prisma.document.create.mockResolvedValueOnce({
      id: 'document-general',
      tenantId: 'tenant-1',
      title: 'Reglamento',
      category: 'OTHER',
      visibility: 'RESIDENTS',
      buildingId: 'building-1',
      unitId: 'unit-1',
      createdByMembership: { user: { id: 'resident-1', name: 'Resident' } },
      file: { bucket: DEFAULT_BUCKET, objectKey: 'tenant-tenant-1/documents/reglamento.pdf' },
    } as never);
    prisma.unitOccupant.findMany.mockResolvedValueOnce([
      { member: { user: { id: 'resident-1' } } },
      { member: { user: { id: 'resident-2' } } },
    ] as never);

    await service.createDocument('tenant-1', 'membership-1', {
      title: 'Reglamento',
      category: 'OTHER',
      visibility: 'RESIDENTS',
      file: {
        ...uploadFile,
        objectKey: 'tenant-tenant-1/documents/reglamento.pdf',
      },
      buildingId: 'building-1',
      unitId: 'unit-1',
    });

    expect(notifications.createNotification).toHaveBeenCalledTimes(1);
    expect(notifications.createNotification).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'resident-2',
      type: 'DOCUMENT_SHARED',
    }));
    expect(notifications.createNotification).not.toHaveBeenCalledWith(expect.objectContaining({
      userId: 'resident-1',
    }));
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

  it('preserves a winning payment-proof object during a concurrent P2002 cleanup', async () => {
    const paymentProof = {
      ...uploadFile,
      objectKey: 'tenant-tenant-1/payment-proofs/shared-proof.pdf',
    };
    const winnerFile = { id: 'file-winner' };
    let resolveWinnerFilePersisted!: () => void;
    const winnerFilePersisted = new Promise<void>((resolve) => {
      resolveWinnerFilePersisted = resolve;
    });
    let releaseWinnerDocument!: () => void;
    const winnerDocumentReleased = new Promise<void>((resolve) => {
      releaseWinnerDocument = resolve;
    });
    let fileLookupCount = 0;
    let fileCreateCount = 0;
    let documentCreateCount = 0;

    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: 1024 } as never);
    prisma.file.findFirst.mockImplementation(async () => {
      fileLookupCount += 1;
      return fileLookupCount <= 2 ? null as never : winnerFile as never;
    });
    prisma.file.create.mockImplementation(async () => {
      fileCreateCount += 1;
      if (fileCreateCount === 1) {
        resolveWinnerFilePersisted();
        return winnerFile as never;
      }

      await winnerFilePersisted;
      throw createPrismaKnownRequestError('P2002');
    });
    prisma.document.create.mockImplementation(async () => {
      documentCreateCount += 1;
      if (documentCreateCount === 1) {
        await winnerDocumentReleased;
      }

      return {
        id: 'document-winner',
        tenantId: 'tenant-1',
        file: paymentProof,
        createdByMembership: { user: { id: 'resident-1', name: 'Resident' } },
      } as never;
    });

    const winnerRequest = service.createDocument('tenant-1', 'membership-1', {
      title: 'Payment proof',
      category: 'RECEIPT',
      visibility: 'RESIDENTS',
      file: paymentProof,
      buildingId: 'building-1',
      unitId: 'unit-1',
    });

    await winnerFilePersisted;
    const losingRequest = service.createDocument('tenant-1', 'membership-1', {
      title: 'Payment proof',
      category: 'RECEIPT',
      visibility: 'RESIDENTS',
      file: paymentProof,
      buildingId: 'building-1',
      unitId: 'unit-1',
    });

    await expect(losingRequest).rejects.toMatchObject({ code: 'P2002' });

    expect(prisma.file.findFirst).toHaveBeenLastCalledWith({
      where: {
        tenantId: 'tenant-1',
        bucket: DEFAULT_BUCKET,
        objectKey: paymentProof.objectKey,
      },
      select: { id: true },
    });
    expect(minio.statObject).toHaveBeenCalledWith(DEFAULT_BUCKET, paymentProof.objectKey);
    expect(minio.deleteObject).not.toHaveBeenCalled();

    releaseWinnerDocument();
    await expect(winnerRequest).resolves.toEqual(expect.objectContaining({ id: 'document-winner' }));
  });

  it('cleans up an orphaned payment-proof object after a P2002', async () => {
    const paymentProof = {
      ...uploadFile,
      objectKey: 'tenant-tenant-1/payment-proofs/orphaned-proof.pdf',
    };

    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: 1024 } as never);
    prisma.file.create.mockRejectedValueOnce(createPrismaKnownRequestError('P2002'));
    prisma.file.findFirst.mockResolvedValue(null);

    await expect(service.createDocument('tenant-1', 'membership-1', {
      title: 'Payment proof',
      category: 'RECEIPT',
      visibility: 'RESIDENTS',
      file: paymentProof,
      buildingId: 'building-1',
      unitId: 'unit-1',
    })).rejects.toMatchObject({ code: 'P2002' });

    expect(prisma.file.findFirst).toHaveBeenLastCalledWith({
      where: {
        tenantId: 'tenant-1',
        bucket: DEFAULT_BUCKET,
        objectKey: paymentProof.objectKey,
      },
      select: { id: true },
    });
    expect(minio.deleteObject).toHaveBeenCalledWith(DEFAULT_BUCKET, paymentProof.objectKey);
  });

  it('rejects payment-proof keys from another tenant before storage or cleanup', async () => {
    const foreignPaymentProof = {
      ...uploadFile,
      objectKey: 'tenant-tenant-2/payment-proofs/foreign-proof.pdf',
    };

    await expect(service.createDocument('tenant-1', 'membership-1', {
      title: 'Payment proof',
      category: 'RECEIPT',
      visibility: 'RESIDENTS',
      file: foreignPaymentProof,
      buildingId: 'building-1',
      unitId: 'unit-1',
    })).rejects.toBeInstanceOf(ForbiddenException);

    expect(minio.objectExists).not.toHaveBeenCalled();
    expect(minio.statObject).not.toHaveBeenCalled();
    expect(minio.deleteObject).not.toHaveBeenCalled();
  });

  it('extracts tenant ids only from valid document and payment-proof keys', () => {
    const documentService = service as unknown as {
      extractTenantIdFromObjectKey(objectKey: string): string;
    };

    expect(documentService.extractTenantIdFromObjectKey('tenant-tenant-1/documents/file.pdf')).toBe('tenant-1');
    expect(documentService.extractTenantIdFromObjectKey('tenant-tenant-1/payment-proofs/file.pdf')).toBe('tenant-1');
    expect(documentService.extractTenantIdFromObjectKey('tenant-/payment-proofs/file.pdf')).toBe('');
    expect(documentService.extractTenantIdFromObjectKey('payment-proofs/tenant-1/file.pdf')).toBe('');
    expect(documentService.extractTenantIdFromObjectKey('tenant-tenant-1/payment-proofs/../file.pdf')).toBe('');
    expect(documentService.extractTenantIdFromObjectKey('tenant-tenant-2/payment-proofs/file.pdf')).toBe('tenant-2');
  });

  it('rejects uploaded files that exceed the backend limit using the real storage size', async () => {
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: GENERAL_DOCUMENT_MAX_BYTES + 1 } as never);

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

  it('accepts a 100 MiB general document using the real storage size', async () => {
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size: GENERAL_DOCUMENT_MAX_BYTES } as never);
    prisma.file.create.mockResolvedValueOnce({ id: 'file-1' } as never);
    prisma.document.create.mockResolvedValueOnce({
      id: 'document-1',
      tenantId: 'tenant-1',
      title: 'Large document',
      category: 'OTHER',
      visibility: 'TENANT_ADMINS',
      file: { ...uploadFile, size: GENERAL_DOCUMENT_MAX_BYTES },
      createdByMembership: { user: { id: 'admin-1', name: 'Admin' } },
    } as never);

    await expect(service.createDocument('tenant-1', 'membership-1', {
      title: 'Large document',
      category: 'OTHER',
      visibility: 'TENANT_ADMINS',
      file: uploadFile,
      buildingId: 'building-1',
      unitId: 'unit-1',
    })).resolves.toEqual(expect.objectContaining({ id: 'document-1' }));
  });

  it.each([
    [PAYMENT_PROOF_MAX_BYTES, true],
    [PAYMENT_PROOF_MAX_BYTES + 1, false],
  ])('enforces the 10 MiB real-storage limit for payment proofs (%i bytes)', async (size, allowed) => {
    minio.objectExists.mockResolvedValue(true);
    minio.statObject.mockResolvedValue({ size } as never);
    const paymentProof = {
      ...uploadFile,
      objectKey: 'tenant-tenant-1/payment-proofs/proof.pdf',
    };

    if (allowed) {
      prisma.file.create.mockResolvedValueOnce({ id: 'file-1' } as never);
      prisma.document.create.mockResolvedValueOnce({
        id: 'document-1',
        tenantId: 'tenant-1',
        title: 'Payment proof',
        category: 'RECEIPT',
        visibility: 'RESIDENTS',
        file: paymentProof,
        createdByMembership: { user: { id: 'resident-1', name: 'Resident' } },
      } as never);

      await expect(service.createDocument('tenant-1', 'membership-1', {
        title: 'Payment proof',
        category: 'RECEIPT',
        visibility: 'RESIDENTS',
        file: paymentProof,
        buildingId: 'building-1',
        unitId: 'unit-1',
      })).resolves.toEqual(expect.objectContaining({ id: 'document-1' }));
      return;
    }

    await expect(service.createDocument('tenant-1', 'membership-1', {
      title: 'Payment proof',
      category: 'RECEIPT',
      visibility: 'RESIDENTS',
      file: paymentProof,
      buildingId: 'building-1',
      unitId: 'unit-1',
    })).rejects.toThrow('10 MB');
    expect(minio.deleteObject).toHaveBeenCalledWith(DEFAULT_BUCKET, paymentProof.objectKey);
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

  it.each([
    {
      scenario: 'payment proof',
      payment: {
        id: 'payment-proof-1',
        tenantId: 'tenant-1',
        proofFileId: 'file-1',
        receiptDocumentId: null,
      },
    },
    {
      scenario: 'payment receipt',
      payment: {
        id: 'payment-receipt-1',
        tenantId: 'tenant-1',
        proofFileId: null,
        receiptDocumentId: 'document-1',
      },
    },
  ])('blocks update when the document is linked through %s', async ({ payment }) => {
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
        id: 'file-1',
        bucket: 'tenant-legacy-bucket',
        objectKey: 'receipt.pdf',
        originalName: 'receipt.pdf',
        mimeType: 'application/pdf',
      },
    } as never);
    prisma.payment.findFirst.mockResolvedValue(payment as never);

    await expect(
      service.updateDocument('tenant-1', 'document-1', 'admin-1', ['TENANT_ADMIN'], {
        title: 'Updated title',
      }),
    ).rejects.toThrow(PAYMENT_LINKED_DOCUMENT_CONFLICT_MESSAGE);

    expect(transactionQueryRawMock).toHaveBeenCalledTimes(1);
    expect(prisma.document.update).not.toHaveBeenCalled();
  });

  it.each([
    {
      scenario: 'payment proof',
      payment: {
        id: 'payment-proof-1',
        tenantId: 'tenant-1',
        proofFileId: 'file-1',
        receiptDocumentId: null,
      },
    },
    {
      scenario: 'payment receipt',
      payment: {
        id: 'payment-receipt-1',
        tenantId: 'tenant-1',
        proofFileId: null,
        receiptDocumentId: 'document-1',
      },
    },
  ])('blocks delete when the document is linked through %s', async ({ payment }) => {
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
        id: 'file-1',
        bucket: 'tenant-legacy-bucket',
        objectKey: 'receipt.pdf',
        originalName: 'receipt.pdf',
        mimeType: 'application/pdf',
      },
    } as never);
    prisma.payment.findFirst.mockResolvedValue(payment as never);

    await expect(
      service.deleteDocument('tenant-1', 'document-1', 'admin-1', ['TENANT_ADMIN']),
    ).rejects.toThrow(PAYMENT_LINKED_DOCUMENT_CONFLICT_MESSAGE);

    expect(transactionQueryRawMock).toHaveBeenCalledTimes(1);
    expect(prisma.document.delete).not.toHaveBeenCalled();
  });

  describe('Payment enrichment (functionalType / origin / payment)', () => {
    beforeEach(() => {
      prisma.payment.findMany.mockResolvedValue([]);
    });

    it('sets functionalType=PAYMENT_RECEIPT and origin=GENERATED when receiptDocumentId matches', async () => {
      prisma.document.findMany.mockResolvedValueOnce([
        {
          id: 'doc-receipt-1',
          tenantId: 'tenant-1',
          fileId: 'file-receipt-1',
          title: 'Comprobante pago - transfer.pdf',
          category: 'RECEIPT',
          visibility: 'RESIDENTS',
          buildingId: null,
          unitId: null,
          createdByMembership: { userId: 'resident-1' },
          file: { bucket: DEFAULT_BUCKET, objectKey: 'proofs/proof.pdf', originalName: 'proof.pdf', mimeType: 'application/pdf' },
        },
      ] as never);

      validators.canAccessDocument.mockReturnValue(true);

      prisma.payment.findMany.mockResolvedValueOnce([
        {
          id: 'pay-1',
          amount: 500000,
          currency: 'UYU',
          status: 'APPROVED',
          reference: 'TR-001',
          receiptNumber: 'REC-2025-001',
          receiptDocumentId: 'doc-receipt-1',
          proofFileId: null,
          paymentAllocations: [{
            charge: { period: '2025-07', expensePeriod: { year: 2025, month: 7 } },
          }],
        },
      ] as never);

      const result = await service.listDocuments('tenant-1', 'resident-1', ['RESIDENT']);

      expect(result[0].functionalType).toBe('PAYMENT_RECEIPT');
      expect(result[0].origin).toBe('GENERATED');
      expect(result[0].payment).toEqual({
        id: 'pay-1',
        amount: 500000,
        currency: 'UYU',
        status: 'APPROVED',
        reference: 'TR-001',
        receiptNumber: 'REC-2025-001',
        period: '2025-07',
      });
    });

    it('sets functionalType=PAYMENT_PROOF and origin=UPLOADED when proofFileId matches', async () => {
      prisma.document.findMany.mockResolvedValueOnce([
        {
          id: 'doc-proof-1',
          tenantId: 'tenant-1',
          fileId: 'file-proof-1',
          title: 'Comprobante pago - transfer.pdf',
          category: 'RECEIPT',
          visibility: 'RESIDENTS',
          buildingId: null,
          unitId: null,
          createdByMembership: { userId: 'resident-1' },
          file: { bucket: DEFAULT_BUCKET, objectKey: 'proofs/proof.pdf', originalName: 'proof.pdf', mimeType: 'application/pdf' },
        },
      ] as never);

      validators.canAccessDocument.mockReturnValue(true);

      prisma.payment.findMany.mockResolvedValueOnce([
        {
          id: 'pay-2',
          amount: 350000,
          currency: 'UYU',
          status: 'SUBMITTED',
          reference: null,
          receiptNumber: null,
          receiptDocumentId: null,
          proofFileId: 'file-proof-1',
          paymentAllocations: [],
        },
      ] as never);

      const result = await service.listDocuments('tenant-1', 'resident-1', ['RESIDENT']);

      expect(result[0].functionalType).toBe('PAYMENT_PROOF');
      expect(result[0].origin).toBe('UPLOADED');
      expect(result[0].payment).toEqual({
        id: 'pay-2',
        amount: 350000,
        currency: 'UYU',
        status: 'SUBMITTED',
        reference: null,
        receiptNumber: null,
        period: null,
      });
    });

    it('prefers receipt over proof when both match', async () => {
      prisma.document.findMany.mockResolvedValueOnce([
        {
          id: 'doc-both',
          tenantId: 'tenant-1',
          fileId: 'file-both',
          title: 'Comprobante pago - transfer.pdf',
          category: 'RECEIPT',
          visibility: 'RESIDENTS',
          buildingId: null,
          unitId: null,
          createdByMembership: { userId: 'resident-1' },
          file: { bucket: DEFAULT_BUCKET, objectKey: 'proofs/proof.pdf', originalName: 'proof.pdf', mimeType: 'application/pdf' },
        },
      ] as never);

      validators.canAccessDocument.mockReturnValue(true);

      prisma.payment.findMany.mockResolvedValueOnce([
        {
          id: 'pay-proof',
          amount: 100000,
          currency: 'UYU',
          status: 'SUBMITTED',
          reference: null,
          receiptNumber: null,
          receiptDocumentId: null,
          proofFileId: 'file-both',
          paymentAllocations: [],
        },
        {
          id: 'pay-receipt',
          amount: 100000,
          currency: 'UYU',
          status: 'APPROVED',
          reference: 'TR-002',
          receiptNumber: 'REC-002',
          receiptDocumentId: 'doc-both',
          proofFileId: null,
          paymentAllocations: [],
        },
      ] as never);

      const result = await service.listDocuments('tenant-1', 'resident-1', ['RESIDENT']);

      expect(result[0].functionalType).toBe('PAYMENT_RECEIPT');
      expect(result[0].origin).toBe('GENERATED');
      expect(result[0].payment?.id).toBe('pay-receipt');
    });

    it('returns null functionalType for documents not linked to any payment', async () => {
      prisma.document.findMany.mockResolvedValueOnce([
        {
          id: 'doc-general',
          tenantId: 'tenant-1',
          fileId: 'file-general',
          title: 'Contrato',
          category: 'OTHER',
          visibility: 'RESIDENTS',
          buildingId: null,
          unitId: null,
          createdByMembership: { userId: 'resident-1' },
          file: { bucket: DEFAULT_BUCKET, objectKey: 'contracts/contract.pdf', originalName: 'contract.pdf', mimeType: 'application/pdf' },
        },
      ] as never);

      validators.canAccessDocument.mockReturnValue(true);

      prisma.payment.findMany.mockResolvedValueOnce([]);

      const result = await service.listDocuments('tenant-1', 'resident-1', ['RESIDENT']);

      expect(result[0].functionalType).toBeNull();
      expect(result[0].origin).toBeNull();
      expect(result[0].payment).toBeNull();
    });

    it('resolves period from expensePeriod when single allocation exists', async () => {
      prisma.document.findMany.mockResolvedValueOnce([
        {
          id: 'doc-period',
          tenantId: 'tenant-1',
          fileId: 'file-period',
          title: 'Comprobante',
          category: 'RECEIPT',
          visibility: 'RESIDENTS',
          buildingId: null,
          unitId: null,
          createdByMembership: { userId: 'resident-1' },
          file: { bucket: DEFAULT_BUCKET, objectKey: 'proofs/proof.pdf', originalName: 'proof.pdf', mimeType: 'application/pdf' },
        },
      ] as never);

      validators.canAccessDocument.mockReturnValue(true);

      prisma.payment.findMany.mockResolvedValueOnce([
        {
          id: 'pay-period',
          amount: 200000,
          currency: 'UYU',
          status: 'APPROVED',
          reference: null,
          receiptNumber: 'REC-003',
          receiptDocumentId: 'doc-period',
          proofFileId: null,
          paymentAllocations: [{
            charge: { period: '2025-08', expensePeriod: { year: 2025, month: 8 } },
          }],
        },
      ] as never);

      const result = await service.listDocuments('tenant-1', 'resident-1', ['RESIDENT']);

      expect(result[0].payment?.period).toBe('2025-08');
    });

    it('returns null period when multiple allocations exist', async () => {
      prisma.document.findMany.mockResolvedValueOnce([
        {
          id: 'doc-multi',
          tenantId: 'tenant-1',
          fileId: 'file-multi',
          title: 'Comprobante',
          category: 'RECEIPT',
          visibility: 'RESIDENTS',
          buildingId: null,
          unitId: null,
          createdByMembership: { userId: 'resident-1' },
          file: { bucket: DEFAULT_BUCKET, objectKey: 'proofs/proof.pdf', originalName: 'proof.pdf', mimeType: 'application/pdf' },
        },
      ] as never);

      validators.canAccessDocument.mockReturnValue(true);

      prisma.payment.findMany.mockResolvedValueOnce([
        {
          id: 'pay-multi',
          amount: 400000,
          currency: 'UYU',
          status: 'APPROVED',
          reference: null,
          receiptNumber: 'REC-004',
          receiptDocumentId: 'doc-multi',
          proofFileId: null,
          paymentAllocations: [
            { charge: { period: '2025-07', expensePeriod: { year: 2025, month: 7 } } },
            { charge: { period: '2025-08', expensePeriod: { year: 2025, month: 8 } } },
          ],
        },
      ] as never);

      const result = await service.listDocuments('tenant-1', 'resident-1', ['RESIDENT']);

      expect(result[0].payment?.period).toBeNull();
    });

    it('never queries payments when document list is empty', async () => {
      prisma.document.findMany.mockResolvedValueOnce([]);

      const result = await service.listDocuments('tenant-1', 'resident-1', ['RESIDENT']);

      expect(result).toEqual([]);
      expect(prisma.payment.findMany).not.toHaveBeenCalled();
    });

    it('scopes payment query by tenantId', async () => {
      prisma.document.findMany.mockResolvedValueOnce([
        {
          id: 'doc-tenant-check',
          tenantId: 'tenant-1',
          fileId: 'file-tenant-check',
          title: 'Comprobante',
          category: 'RECEIPT',
          visibility: 'RESIDENTS',
          buildingId: null,
          unitId: null,
          createdByMembership: { userId: 'resident-1' },
          file: { bucket: DEFAULT_BUCKET, objectKey: 'proofs/proof.pdf', originalName: 'proof.pdf', mimeType: 'application/pdf' },
        },
      ] as never);

      validators.canAccessDocument.mockReturnValue(true);

      prisma.payment.findMany.mockResolvedValueOnce([]);

      await service.listDocuments('tenant-1', 'resident-1', ['RESIDENT']);

      expect(prisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
        }),
      }));
    });

    it('queries paymentAllocations with take: 2 to detect multi-period', async () => {
      prisma.document.findMany.mockResolvedValueOnce([
        {
          id: 'doc-take-check',
          tenantId: 'tenant-1',
          fileId: 'file-take-check',
          title: 'Comprobante',
          category: 'RECEIPT',
          visibility: 'RESIDENTS',
          buildingId: null,
          unitId: null,
          createdByMembership: { userId: 'resident-1' },
          file: { bucket: DEFAULT_BUCKET, objectKey: 'proofs/proof.pdf', originalName: 'proof.pdf', mimeType: 'application/pdf' },
        },
      ] as never);

      validators.canAccessDocument.mockReturnValue(true);
      prisma.payment.findMany.mockResolvedValueOnce([]);

      await service.listDocuments('tenant-1', 'resident-1', ['RESIDENT']);

      const call = prisma.payment.findMany.mock.calls[0][0] as Record<string, unknown>;
      const allocations = ((call.where as Record<string, unknown>).OR ? [] : [])
        .concat([]);
      const select = call.select as Record<string, unknown>;
      const allocSelect = select.paymentAllocations as Record<string, unknown>;
      expect(allocSelect.take).toBe(2);
    });

    it('returns null period when 3+ allocations exist (take:2 fetches at most 2)', async () => {
      prisma.document.findMany.mockResolvedValueOnce([
        {
          id: 'doc-three-allocs',
          tenantId: 'tenant-1',
          fileId: 'file-three-allocs',
          title: 'Comprobante',
          category: 'RECEIPT',
          visibility: 'RESIDENTS',
          buildingId: null,
          unitId: null,
          createdByMembership: { userId: 'resident-1' },
          file: { bucket: DEFAULT_BUCKET, objectKey: 'proofs/proof.pdf', originalName: 'proof.pdf', mimeType: 'application/pdf' },
        },
      ] as never);

      validators.canAccessDocument.mockReturnValue(true);

      prisma.payment.findMany.mockResolvedValueOnce([
        {
          id: 'pay-three',
          amount: 600000,
          currency: 'UYU',
          status: 'APPROVED',
          reference: null,
          receiptNumber: 'REC-005',
          receiptDocumentId: 'doc-three-allocs',
          proofFileId: null,
          paymentAllocations: [
            { charge: { period: '2025-06', expensePeriod: { year: 2025, month: 6 } } },
            { charge: { period: '2025-07', expensePeriod: { year: 2025, month: 7 } } },
          ],
        },
      ] as never);

      const result = await service.listDocuments('tenant-1', 'resident-1', ['RESIDENT']);

      expect(result[0].payment?.period).toBeNull();
    });

    it('skips enrichment for payments with canceledAt set', async () => {
      prisma.document.findMany.mockResolvedValueOnce([
        {
          id: 'doc-canceled-proof',
          tenantId: 'tenant-1',
          fileId: 'file-canceled-proof',
          title: 'Comprobante pago - cancelado.pdf',
          category: 'RECEIPT',
          visibility: 'RESIDENTS',
          buildingId: null,
          unitId: null,
          createdByMembership: { userId: 'resident-1' },
          file: { bucket: DEFAULT_BUCKET, objectKey: 'proofs/canceled.pdf', originalName: 'canceled.pdf', mimeType: 'application/pdf' },
        },
      ] as never);

      validators.canAccessDocument.mockReturnValue(true);

      // canceled payment is excluded by the canceledAt: null filter
      prisma.payment.findMany.mockResolvedValueOnce([]);

      const result = await service.listDocuments('tenant-1', 'resident-1', ['RESIDENT']);

      expect(result[0].functionalType).toBeNull();
      expect(result[0].origin).toBeNull();
      expect(result[0].payment).toBeNull();
    });

    it('query includes canceledAt: null filter', async () => {
      prisma.document.findMany.mockResolvedValueOnce([
        {
          id: 'doc-cancel-check',
          tenantId: 'tenant-1',
          fileId: 'file-cancel-check',
          title: 'Comprobante',
          category: 'RECEIPT',
          visibility: 'RESIDENTS',
          buildingId: null,
          unitId: null,
          createdByMembership: { userId: 'resident-1' },
          file: { bucket: DEFAULT_BUCKET, objectKey: 'proofs/proof.pdf', originalName: 'proof.pdf', mimeType: 'application/pdf' },
        },
      ] as never);

      validators.canAccessDocument.mockReturnValue(true);
      prisma.payment.findMany.mockResolvedValueOnce([]);

      await service.listDocuments('tenant-1', 'resident-1', ['RESIDENT']);

      expect(prisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          canceledAt: null,
        }),
      }));
    });
  });
});
