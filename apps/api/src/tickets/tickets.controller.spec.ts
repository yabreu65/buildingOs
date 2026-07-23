import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { ResidentAccessService } from '../resident-access/resident-access.service';

describe('TicketsController', () => {
  const ticketsService = {
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    addComment: jest.fn(),
    validateResidentUnitAccess: jest.fn(),
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

  it('forces resident-created tickets to canonical defaults and removes assignment', async () => {
    residentAccess.shouldEnforce.mockReturnValue(true);
    residentAccess.getActiveUnitIds.mockResolvedValue(['unit-1']);
    ticketsService.create.mockResolvedValue({ id: 'ticket-1' } as never);

    await controller.create(
      'building-1',
      { title: 'Leak', description: 'Water leak', unitId: 'unit-1', assignedToMembershipId: 'member-1', priority: 'URGENT', category: 'REPAIR' } as never,
      { tenantId: 'tenant-1', user: { id: 'resident-1', roles: ['RESIDENT'] } } as never,
    );

    expect(ticketsService.create).toHaveBeenCalledWith(
      'tenant-1',
      'building-1',
      'resident-1',
      expect.objectContaining({ category: 'REPAIR', priority: 'MEDIUM', assignedToMembershipId: undefined }),
    );
  });

  it('rejects resident ticket mutation endpoints', async () => {
    residentAccess.shouldEnforce.mockReturnValue(true);
    const request = { tenantId: 'tenant-1', user: { id: 'resident-1', roles: ['RESIDENT'] } } as never;

    await expect(controller.update('building-1', 'ticket-1', {}, request)).rejects.toThrow('Missing required ticket permission: tickets.manage');
    await expect(controller.remove('building-1', 'ticket-1', request)).rejects.toThrow('Missing required ticket permission: tickets.manage');
    expect(ticketsService.update).not.toHaveBeenCalled();
    expect(ticketsService.remove).not.toHaveBeenCalled();
  });

  it('allows operator and tenant admin management', async () => {
    residentAccess.shouldEnforce.mockReturnValue(false);
    const operatorRequest = { tenantId: 'tenant-1', user: { id: 'operator-1', roles: ['OPERATOR'] } } as never;
    ticketsService.update.mockResolvedValue({ id: 'ticket-1', title: 'Updated' } as never);
    await expect(controller.update('building-1', 'ticket-1', { title: 'Updated' }, operatorRequest)).resolves.toEqual({ id: 'ticket-1', title: 'Updated' });

    const adminRequest = { tenantId: 'tenant-1', user: { id: 'admin-1', roles: ['TENANT_ADMIN'] } } as never;
    await expect(controller.update('building-1', 'ticket-1', { title: 'Updated' }, adminRequest)).resolves.toEqual({ id: 'ticket-1', title: 'Updated' });
  });

  it('allows an operator to add an administrative comment within the building scope', async () => {
    residentAccess.shouldEnforce.mockReturnValue(false);
    ticketsService.addComment.mockResolvedValue({ id: 'comment-1', body: 'Estamos revisando' } as never);

    await expect(controller.addComment(
      'building-1',
      'ticket-1',
      { body: 'Estamos revisando' },
      { tenantId: 'tenant-1', user: { id: 'operator-1', roles: ['OPERATOR'] } } as never,
    )).resolves.toEqual({ id: 'comment-1', body: 'Estamos revisando' });

    expect(ticketsService.addComment).toHaveBeenCalledWith(
      'tenant-1',
      'building-1',
      'ticket-1',
      'operator-1',
      { body: 'Estamos revisando' },
    );
  });
});
