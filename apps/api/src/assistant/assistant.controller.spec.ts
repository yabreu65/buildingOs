import { ForbiddenException } from '@nestjs/common';
import { AssistantController } from './assistant.controller';

describe('AssistantController P0 hardening', () => {
  const assistantService = {
    chat: jest.fn(),
    getTicketReplySuggestions: jest.fn(),
  } as any;
  const analyticsService = {} as any;
  const actionEventsService = {} as any;
  const aiEntitlements = {
    hasRemainingConsultations: jest.fn(),
    trackConsumption: jest.fn(),
  } as any;

  let controller: AssistantController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AssistantController(
      assistantService,
      analyticsService,
      actionEventsService,
      aiEntitlements,
    );
    aiEntitlements.hasRemainingConsultations.mockResolvedValue(true);
    aiEntitlements.trackConsumption.mockResolvedValue(undefined);
    assistantService.getTicketReplySuggestions.mockResolvedValue(['r1', 'r2', 'r3']);
  });

  it('rejects resident ticket reply suggestions before provider execution', async () => {
    await expect(
      controller.getTicketReplySuggestions(
        'tenant-1',
        { ticketId: 'ticket-1', title: 'Title', description: 'Description' },
        {
          user: {
            id: 'resident-user',
            memberships: [{ id: 'membership-1', tenantId: 'tenant-1', roles: ['RESIDENT'] }],
          },
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(assistantService.getTicketReplySuggestions).not.toHaveBeenCalled();
  });

  it('allows operator ticket reply suggestions for same tenant membership', async () => {
    const result = await controller.getTicketReplySuggestions(
      'tenant-1',
      { ticketId: 'ticket-1', title: 'Title', description: 'Description' },
      {
        user: {
          id: 'operator-user',
          memberships: [{ id: 'membership-1', tenantId: 'tenant-1', roles: ['OPERATOR'] }],
        },
      },
    );

    expect(result).toEqual({ replies: ['r1', 'r2', 'r3'] });
    expect(assistantService.getTicketReplySuggestions).toHaveBeenCalledWith(
      'tenant-1',
      'ticket-1',
      'Title',
      'Description',
      'operator-user',
      ['OPERATOR'],
    );
  });
});
