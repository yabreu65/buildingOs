import { ForbiddenException } from '@nestjs/common';
import { HitlRepository } from './hitl.repository';
import { HitlService } from './hitl.service';

describe('HitlService', () => {
  const originalEnv = process.env;

  const repository = {
    list: jest.fn(),
    findById: jest.fn(),
    assign: jest.fn(),
    resolve: jest.fn(),
    dismiss: jest.fn(),
    createAudit: jest.fn(),
    createMessage: jest.fn(),
  } as unknown as jest.Mocked<HitlRepository>;

  const queue = {
    enqueueRespond: jest.fn(),
  } as any;

  let service: HitlService;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.HITL_RESPOND_ENABLED;
    delete process.env.HITL_RESPOND_CANARY_TENANTS;
    delete process.env.HITL_RESPOND_DEFAULT_CHANNEL;
    jest.clearAllMocks();
    service = new HitlService(repository, queue);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('enforces tenant isolation (tenant A cannot access tenant B handoff)', async () => {
    repository.findById.mockResolvedValueOnce({
      id: 'h-1',
      tenantId: 'tenant-b',
      status: 'OPEN',
    } as any);

    await expect(
      service.getById(
        {
          userId: 'user-a',
          isSuperAdmin: false,
          tenantId: 'tenant-a',
          roles: ['TENANT_ADMIN'],
        },
        'h-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('tenant A cannot list tenant B handoffs', async () => {
    await expect(
      service.list(
        {
          userId: 'user-a',
          isSuperAdmin: false,
          tenantId: 'tenant-a',
          roles: ['TENANT_ADMIN'],
        },
        { tenantId: 'tenant-b' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(repository.list).not.toHaveBeenCalled();
  });

  it('denies RBAC for non-ops roles', async () => {
    await expect(
      service.list(
        {
          userId: 'resident-1',
          isSuperAdmin: false,
          tenantId: 'tenant-a',
          roles: ['RESIDENT'],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(repository.list).not.toHaveBeenCalled();
  });

  it('RBAC: only ops roles can resolve handoffs', async () => {
    await expect(
      service.resolve(
        {
          userId: 'resident-1',
          isSuperAdmin: false,
          tenantId: 'tenant-a',
          roles: ['RESIDENT'],
        },
        'h-1',
        'nota',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(repository.resolve).not.toHaveBeenCalled();
    expect(repository.createMessage).not.toHaveBeenCalled();
  });

  it('assign + resolve transitions update state and write audit log', async () => {
    repository.findById.mockResolvedValue({
      id: 'h-1',
      tenantId: 'tenant-a',
      status: 'OPEN',
    } as any);

    repository.assign.mockResolvedValueOnce({
      id: 'h-1',
      status: 'IN_PROGRESS',
      assignedToUserId: 'ops-1',
    } as any);

    repository.resolve.mockResolvedValueOnce({
      id: 'h-1',
      tenantId: 'tenant-a',
      userId: 'resident-1',
      traceId: 'tr-1',
      status: 'RESOLVED',
      resolutionNote: 'Se respondió con detalle de pagos',
    } as any);
    repository.createMessage.mockResolvedValue({
      id: 'm-1',
      tenantId: 'tenant-a',
      userId: 'resident-1',
      handoffId: 'h-1',
      traceId: 'tr-1',
      channel: 'IN_APP',
      deliveryStatus: 'DELIVERED',
    });

    await service.assign(
      {
        userId: 'ops-1',
        isSuperAdmin: false,
        tenantId: 'tenant-a',
        roles: ['OPERATOR'],
      },
      'h-1',
    );

    expect(repository.assign).toHaveBeenCalledWith({
      id: 'h-1',
      assignedToUserId: 'ops-1',
    });
    expect(repository.createAudit).toHaveBeenCalledWith({
      handoffId: 'h-1',
      actorUserId: 'ops-1',
      action: 'handoff.assign',
    });

    await service.resolve(
      {
        userId: 'ops-1',
        isSuperAdmin: false,
        tenantId: 'tenant-a',
        roles: ['OPERATOR'],
      },
      'h-1',
      'Se respondió con detalle de pagos',
    );

    expect(repository.resolve).toHaveBeenCalledWith({
      id: 'h-1',
      resolutionNote: 'Se respondió con detalle de pagos',
      actorUserId: 'ops-1',
    });
    expect(repository.createMessage).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      userId: 'resident-1',
      handoffId: 'h-1',
      traceId: 'tr-1',
      content: 'Se respondió con detalle de pagos',
      createdByUserId: 'ops-1',
      channel: 'IN_APP',
      deliveryStatus: 'DELIVERED',
    });
    expect(queue.enqueueRespond).not.toHaveBeenCalled();
    expect(repository.createAudit).toHaveBeenCalledWith({
      handoffId: 'h-1',
      actorUserId: 'ops-1',
      action: 'handoff.resolve',
    });
  });

  it('notifyUser enqueues hitl.respond when tenant channel is enabled', async () => {
    process.env.HITL_RESPOND_ENABLED = 'true';
    process.env.HITL_RESPOND_CANARY_TENANTS = 'tenant-a';
    process.env.HITL_RESPOND_DEFAULT_CHANNEL = 'EMAIL';

    repository.findById.mockResolvedValue({
      id: 'h-1',
      tenantId: 'tenant-a',
      status: 'OPEN',
    } as any);

    repository.resolve.mockResolvedValueOnce({
      id: 'h-1',
      tenantId: 'tenant-a',
      userId: 'resident-1',
      traceId: 'tr-1',
      status: 'RESOLVED',
      resolutionNote: 'Respuesta',
    } as any);

    repository.createMessage
      .mockResolvedValueOnce({
        id: 'in-app-1',
        tenantId: 'tenant-a',
        userId: 'resident-1',
        handoffId: 'h-1',
        traceId: 'tr-1',
        channel: 'IN_APP',
        deliveryStatus: 'DELIVERED',
      })
      .mockResolvedValueOnce({
        id: 'external-1',
        tenantId: 'tenant-a',
        userId: 'resident-1',
        handoffId: 'h-1',
        traceId: 'tr-1',
        channel: 'EMAIL',
        deliveryStatus: 'QUEUED',
      });

    const result = await service.resolve(
      {
        userId: 'ops-1',
        isSuperAdmin: false,
        tenantId: 'tenant-a',
        roles: ['OPERATOR'],
      },
      'h-1',
      'Respuesta',
      { notifyUser: true },
    );

    expect(repository.createMessage).toHaveBeenNthCalledWith(2, {
      tenantId: 'tenant-a',
      userId: 'resident-1',
      handoffId: 'h-1',
      traceId: 'tr-1',
      content: 'Respuesta',
      createdByUserId: 'ops-1',
      channel: 'EMAIL',
      deliveryStatus: 'QUEUED',
    });
    expect(queue.enqueueRespond).toHaveBeenCalledWith({
      messageId: 'external-1',
      tenantId: 'tenant-a',
      userId: 'resident-1',
      handoffId: 'h-1',
      traceId: 'tr-1',
    });
    expect(result.notifyEnqueued).toBe(true);
  });
});
