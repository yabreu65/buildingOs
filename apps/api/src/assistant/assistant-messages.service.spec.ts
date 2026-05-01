import { AssistantMessagesService } from './assistant-messages.service';

describe('AssistantMessagesService', () => {
  const prisma = {
    assistantMessage: {
      findMany: jest.fn(),
    },
  } as any;

  let service: AssistantMessagesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AssistantMessagesService(prisma);
  });

  it('enforces tenant isolation in user message listing', async () => {
    prisma.assistantMessage.findMany.mockResolvedValueOnce([
      {
        id: 'm-1',
        tenantId: 'tenant-a',
        userId: 'user-a',
        content: 'ok',
      },
    ]);

    await service.listForUser({
      tenantId: 'tenant-a',
      userId: 'user-a',
      limit: 20,
    });

    expect(prisma.assistantMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant-a',
          userId: 'user-a',
        },
      }),
    );
  });
});

