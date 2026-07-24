import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ResidentAccessService } from '../resident-access/resident-access.service';
import { StreamableFile } from '@nestjs/common';

describe('DocumentsController', () => {
  const documentsService = {
    createDocument: jest.fn(),
    checkResidentUnitAccess: jest.fn(),
    getDownloadUrl: jest.fn(),
    getDocumentContent: jest.fn(),
  } as unknown as jest.Mocked<DocumentsService>;
  const residentAccess = {
    shouldEnforce: jest.fn(),
  } as unknown as jest.Mocked<ResidentAccessService>;
  const controller = new DocumentsController(documentsService, residentAccess);

  beforeEach(() => jest.clearAllMocks());

  it('preserves TENANT_ADMIN receipt access when the effective role list also contains RESIDENT', async () => {
    residentAccess.shouldEnforce.mockReturnValue(false);
    documentsService.createDocument.mockResolvedValue({ id: 'document-1' } as never);

    await controller.create(
      {
        category: 'RECEIPT',
        title: 'Admin receipt',
        file: {
          objectKey: 'tenant-1/documents/proof.pdf',
          originalName: 'proof.pdf',
          mimeType: 'application/pdf',
          size: 10,
        },
        unitId: 'foreign-unit',
      },
      {
        tenantId: 'tenant-1',
        user: {
          id: 'admin-1',
          roles: ['TENANT_ADMIN', 'RESIDENT'],
          memberships: [{ id: 'membership-1', tenantId: 'tenant-1', roles: ['TENANT_ADMIN', 'RESIDENT'] }],
        },
      } as never,
    );

    expect(residentAccess.shouldEnforce).toHaveBeenCalledWith(['TENANT_ADMIN', 'RESIDENT']);
    expect(documentsService.checkResidentUnitAccess).not.toHaveBeenCalled();
    expect(documentsService.createDocument).toHaveBeenCalledWith(
      'tenant-1',
      'membership-1',
      expect.objectContaining({ unitId: 'foreign-unit' }),
    );
  });

  it('streams protected document content with safe headers for authenticated users', async () => {
    documentsService.getDocumentContent.mockResolvedValue({
      stream: {} as never,
      contentType: 'application/pdf',
      contentLength: 42,
      fileName: 'receipt.pdf',
      disposition: 'inline',
    } as never);

    const result = await controller.getContent(
      'document-1',
      {
        tenantId: 'tenant-1',
        user: {
          id: 'resident-1',
          roles: ['RESIDENT'],
          memberships: [{ id: 'membership-1', tenantId: 'tenant-1', roles: ['RESIDENT'] }],
        },
      } as never,
    );

    expect(documentsService.getDocumentContent).toHaveBeenCalledWith(
      'tenant-1',
      'document-1',
      'resident-1',
      ['RESIDENT'],
      false,
    );
    expect(result).toBeInstanceOf(StreamableFile);
    expect(result.getHeaders()).toEqual({
      type: 'application/pdf',
      disposition: 'inline; filename="receipt.pdf"',
      length: 42,
    });
  });
});
