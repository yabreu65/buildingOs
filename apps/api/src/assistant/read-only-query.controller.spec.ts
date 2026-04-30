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
      controller.query(request, undefined, 'tenant-1', 'user-1', 'TENANT_ADMIN', {
        tenantId: 'tenant-1',
        userId: 'user-1',
        role: 'TENANT_ADMIN',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    // middleware/guard context is mandatory; body/header cannot be authoritative
    await expect(
      controller.query(request, 'test-key', 'tenant-1', 'user-1', 'TENANT_ADMIN', {} as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('passes normalized header context to service', async () => {
    service.execute.mockResolvedValue({ answer: 'ok' });

    await controller.query(
      request,
      '  test-key  ',
      ' tenant-1 ',
      ' user-1 ',
      ' tenant_admin ',
      {
        tenantId: 'tenant-1',
        userId: 'user-1',
        role: 'TENANT_ADMIN',
      } as any,
    );

    expect(service.execute).toHaveBeenCalledWith({
      ...request,
      context: {
        ...request.context,
        appId: 'buildingos',
        tenantId: 'tenant-1',
        userId: 'user-1',
        role: 'TENANT_ADMIN',
      },
    }, {
      apiKey: 'test-key',
      tenantId: 'tenant-1',
      userId: 'user-1',
      role: 'TENANT_ADMIN',
      context: expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        role: 'TENANT_ADMIN',
      }),
    });
  });

  it('rejects request context tenant mismatch against authoritative context', async () => {
    await expect(
      controller.query(
        request,
        'test-key',
        'tenant-auth',
        'user-1',
        'TENANT_ADMIN',
        {
          tenantId: 'tenant-auth',
          userId: 'user-1',
          role: 'TENANT_ADMIN',
        } as any,
      ),
    ).rejects.toThrow('Tenant mismatch between authoritative context and request context');
  });

  it('rejects header mismatch against authoritative context', async () => {
    await expect(
      controller.query(
        request,
        'test-key',
        'tenant-other',
        'user-1',
        'TENANT_ADMIN',
        {
          tenantId: 'tenant-1',
          userId: 'user-1',
          role: 'TENANT_ADMIN',
        } as any,
      ),
    ).rejects.toThrow('Tenant mismatch between header and authoritative context');
  });

  it('rejects roles not allowed for read-only endpoint', async () => {
    await expect(
      controller.query(
        request,
        'test-key',
        'tenant-1',
        'user-1',
        'RESIDENT',
        {
          tenantId: 'tenant-1',
          userId: 'user-1',
          role: 'RESIDENT',
        } as any,
      ),
    ).rejects.toThrow('Role not allowed for read-only assistant endpoint');
  });
});
