import { AssistantHitlService, HITL_FALLBACK_WHITELIST } from './hitl.service';

describe('AssistantHitlService', () => {
  const prisma = {
    tenant: {
      findUnique: jest.fn(),
    },
    assistantHandoff: {
      create: jest.fn(),
    },
  } as any;

  const queue = {
    enqueueNotify: jest.fn(),
  } as any;

  const service = new AssistantHitlService(prisma, queue);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('tenant sin managed_service_enabled => no crea handoff', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1', managedServiceEnabled: false });

    const result = await service.maybeCreateHandoff({
      tenantId: 't1',
      userId: 'u1',
      role: 'TENANT_ADMIN',
      question: 'test',
      traceId: 'tr-1',
      resolvedLevel: 'FALLBACK',
      fallbackPath: HITL_FALLBACK_WHITELIST[0],
      gatewayOutcome: 'unavailable',
      contextJson: {},
    });

    expect(result).toEqual({ created: false });
    expect(prisma.assistantHandoff.create).not.toHaveBeenCalled();
    expect(queue.enqueueNotify).not.toHaveBeenCalled();
  });

  it('tenant con enabled + fallback permitido => crea handoff + encola job', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1', managedServiceEnabled: true });
    prisma.assistantHandoff.create.mockResolvedValue({ id: 'h1' });

    const result = await service.maybeCreateHandoff({
      tenantId: 't1',
      userId: 'u1',
      role: 'TENANT_ADMIN',
      question: 'test',
      traceId: 'tr-1',
      resolvedLevel: 'FALLBACK',
      fallbackPath: HITL_FALLBACK_WHITELIST[0],
      gatewayOutcome: 'unavailable',
      contextJson: { page: 'assistant' },
    });

    expect(result).toEqual({ created: true, handoffId: 'h1' });
    expect(prisma.assistantHandoff.create).toHaveBeenCalledTimes(1);
    expect(queue.enqueueNotify).toHaveBeenCalledTimes(1);
  });

  it('tenant con enabled + fallback no permitido => no crea handoff', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: 't1', managedServiceEnabled: true });

    const result = await service.maybeCreateHandoff({
      tenantId: 't1',
      userId: 'u1',
      role: 'TENANT_ADMIN',
      question: 'test',
      traceId: 'tr-1',
      resolvedLevel: 'P0',
      fallbackPath: 'none',
      gatewayOutcome: 'success',
      contextJson: {},
    });

    expect(result).toEqual({ created: false });
    expect(prisma.assistantHandoff.create).not.toHaveBeenCalled();
    expect(queue.enqueueNotify).not.toHaveBeenCalled();
  });
});
