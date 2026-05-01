import { ForbiddenException } from '@nestjs/common';
import { AssistantMessagesController } from './assistant-messages.controller';
import { AssistantMessagesService } from './assistant-messages.service';

describe('AssistantMessagesController', () => {
  const service = {
    listForUser: jest.fn(),
  } as unknown as jest.Mocked<AssistantMessagesService>;

  let controller: AssistantMessagesController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AssistantMessagesController(service);
  });

  it('denies tenant mismatch when x-tenant-id is outside memberships', async () => {
    const req = {
      user: {
        id: 'user-a',
        memberships: [
          { tenantId: 'tenant-a', roles: ['RESIDENT'] },
          { tenantId: 'tenant-b', roles: ['RESIDENT'] },
        ],
      },
      headers: {
        'x-tenant-id': 'tenant-c',
      },
      params: {},
    } as any;

    await expect(controller.list(req, undefined, '20')).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.listForUser).not.toHaveBeenCalled();
  });
});
