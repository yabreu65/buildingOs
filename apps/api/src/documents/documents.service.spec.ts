import { DocumentsService } from './documents.service';
import { DocumentsValidators } from './documents.validators';
import { ResidentAccessService } from '../resident-access/resident-access.service';

describe('DocumentsService', () => {
  const prisma = {
    document: {
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const validators = {
    validateResidentDocumentAccess: jest.fn(),
  } as unknown as jest.Mocked<DocumentsValidators>;
  const minio = {
    deleteObject: jest.fn(),
  };
  const notifications = {};
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

  const createdDocument = {
    id: 'document-1',
    tenantId: 'tenant-1',
    buildingId: 'building-1',
    unitId: 'unit-1',
    visibility: 'PRIVATE',
    title: 'Receipt',
    category: 'RECEIPT',
    createdByMembership: { userId: 'resident-1' },
    file: { bucket: 'tenant-1', objectKey: 'receipt.pdf' },
  };

  beforeEach(() => jest.clearAllMocks());

  it('requires a current occupancy before a resident creator can update a document', async () => {
    prisma.document.findFirst.mockResolvedValue(createdDocument);
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
    prisma.document.findFirst.mockResolvedValue(createdDocument);
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
