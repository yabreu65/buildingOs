import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ResidentAccessService } from '../resident-access/resident-access.service';

describe('DocumentsController', () => {
  const documentsService = {
    createDocument: jest.fn(),
    checkResidentUnitAccess: jest.fn(),
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
        objectKey: 'tenant-1/documents/proof.pdf',
        size: 10,
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
});
