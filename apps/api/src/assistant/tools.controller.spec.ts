import { BadRequestException } from '@nestjs/common';
import { AssistantToolsController } from './tools.controller';

describe('AssistantToolsController', () => {
  const service = {
    executeTool: jest.fn(),
  } as any;

  let controller: AssistantToolsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AssistantToolsController(service);
  });

  it('rejects tools outside allowlist', async () => {
    await expect(
      controller.executeTool(
        'delete_everything',
        {
          context: {
            tenantId: 'tenant-1',
            userId: 'user-1',
            role: 'TENANT_ADMIN',
          },
        } as any,
        'test-key',
        'tenant-1',
        'user-1',
        'TENANT_ADMIN',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forwards tool execution with authoritative headers', async () => {
    service.executeTool.mockResolvedValue({ answer: 'ok' });

    await controller.executeTool(
      'search_tickets',
      {
        question: 'tickets abiertos',
        context: {
          tenantId: 'tenant-1',
          userId: 'user-1',
          role: 'TENANT_ADMIN',
        },
      } as any,
      'test-key',
      'tenant-1',
      'user-1',
      'TENANT_ADMIN',
    );

    expect(service.executeTool).toHaveBeenCalledWith(
      'search_tickets',
      expect.any(Object),
      {
        apiKey: 'test-key',
        tenantId: 'tenant-1',
        userId: 'user-1',
        role: 'TENANT_ADMIN',
      },
    );
  });
});
