import { TenantTicketsController } from './tenant-tickets.controller';
import { TicketsService } from './tickets.service';

describe('TenantTicketsController', () => {
  const ticketsService = {
    findOneByTenantAndId: jest.fn(),
  } as unknown as jest.Mocked<TicketsService>;

  const controller = new TenantTicketsController(ticketsService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads the canonical ticket detail with tenantId and ticketId', async () => {
    ticketsService.findOneByTenantAndId.mockResolvedValue({ id: 'ticket-1' } as never);

    await expect(controller.findOne('tenant-1', 'ticket-1', { user: { id: 'user-1' } } as never)).resolves.toEqual({ id: 'ticket-1' });
    expect(ticketsService.findOneByTenantAndId).toHaveBeenCalledWith('tenant-1', 'ticket-1', { id: 'user-1' });
  });
});
