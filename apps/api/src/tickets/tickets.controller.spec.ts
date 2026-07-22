import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { ResidentAccessService } from '../resident-access/resident-access.service';

describe('TicketsController', () => {
  const ticketsService = {
    findAll: jest.fn(),
  } as unknown as jest.Mocked<TicketsService>;
  const residentAccess = {
    shouldEnforce: jest.fn(),
    getActiveUnitIds: jest.fn(),
  } as unknown as jest.Mocked<ResidentAccessService>;
  const controller = new TicketsController(ticketsService, residentAccess);

  beforeEach(() => jest.clearAllMocks());

  it('does not self-scope a TENANT_ADMIN whose effective roles also include RESIDENT', async () => {
    residentAccess.shouldEnforce.mockReturnValue(false);
    ticketsService.findAll.mockResolvedValue({ tickets: [], total: 0, page: 1, limit: 10, totalPages: 0 } as never);

    await controller.findAll(
      'building-1',
      { tenantId: 'tenant-1', user: { id: 'admin-1', roles: ['TENANT_ADMIN', 'RESIDENT'] } } as never,
    );

    expect(residentAccess.shouldEnforce).toHaveBeenCalledWith(['TENANT_ADMIN', 'RESIDENT']);
    expect(residentAccess.getActiveUnitIds).not.toHaveBeenCalled();
    expect(ticketsService.findAll).toHaveBeenCalledWith('tenant-1', 'building-1', {});
  });
});
