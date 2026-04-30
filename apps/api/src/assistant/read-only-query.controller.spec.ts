import { BadRequestException } from '@nestjs/common';
import { AssistantReadOnlyQueryController } from './read-only-query.controller';

describe('AssistantReadOnlyQueryController', () => {
  const request = {
    question: 'estado de pagos',
    intentCode: 'GET_PENDING_PAYMENTS',
    context: {
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'TENANT_ADMIN',
    },
  } as any;

  const service = {
    execute: jest.fn(),
  } as any;

  let controller: AssistantReadOnlyQueryController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AssistantReadOnlyQueryController(service);
  });

  it('requires authoritative headers for internal endpoint', async () => {
    await expect(
      controller.query(request, undefined, 'tenant-1', 'user-1', 'TENANT_ADMIN'),
    ).rejects.toBeInstanceOf(BadRequestException);

    // request already includes context, so x-tenant-id/x-user-id/x-user-role are optional
    await expect(
      controller.query(request, 'test-key', undefined, 'user-1', 'TENANT_ADMIN'),
    ).resolves.not.toThrow();
  });

  it('passes normalized header context to service', async () => {
    service.execute.mockResolvedValue({ answer: 'ok' });

    await controller.query(
      request,
      '  test-key  ',
      ' tenant-1 ',
      ' user-1 ',
      ' tenant_admin ',
    );

    expect(service.execute).toHaveBeenCalledWith(request, {
      apiKey: 'test-key',
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'TENANT_ADMIN',
      context: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        role: 'TENANT_ADMIN',
      },
    });
  });
});
