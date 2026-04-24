import { ForbiddenException } from '@nestjs/common';
import { AssistantToolsService } from './tools.service';

describe('AssistantToolsService', () => {
  const previousApiKeys = process.env.ASSISTANT_READONLY_API_KEYS;

  beforeEach(() => {
    process.env.ASSISTANT_READONLY_API_KEYS = 'test-readonly-key';
  });

  afterEach(() => {
    process.env.ASSISTANT_READONLY_API_KEYS = previousApiKeys;
  });

  const makeService = () => {
    const prisma = {
      membership: { findUnique: jest.fn() },
      building: { findMany: jest.fn() },
      unit: { findMany: jest.fn(), findUniqueOrThrow: jest.fn() },
      charge: { findMany: jest.fn() },
      payment: { findMany: jest.fn() },
      ticket: { findMany: jest.fn() },
      unitOccupant: { findMany: jest.fn() },
    } as any;
    const audit = { createLog: jest.fn() } as any;
    const service = new AssistantToolsService(prisma, audit);
    return { service, prisma, audit };
  };

  it('blocks tenant spoofing mismatch between headers and context', async () => {
    const { service } = makeService();

    await expect(
      service.executeTool(
        'search_tickets',
        {
          question: 'tickets abiertos',
          context: {
            tenantId: 'tenant-body',
            userId: 'user-1',
            role: 'TENANT_ADMIN',
          },
        },
        {
          apiKey: 'test-readonly-key',
          tenantId: 'tenant-header',
          userId: 'user-1',
          role: 'TENANT_ADMIN',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies role without tool permission', async () => {
    const { service, prisma } = makeService();
    prisma.membership.findUnique.mockResolvedValue({
      roles: [{ role: 'RESIDENT' }],
    });

    await expect(
      service.executeTool(
        'search_payments',
        {
          question: 'pagos pendientes',
          context: {
            tenantId: 'tenant-1',
            userId: 'user-1',
            role: 'RESIDENT',
          },
        },
        {
          apiKey: 'test-readonly-key',
          tenantId: 'tenant-1',
          userId: 'user-1',
          role: 'RESIDENT',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('asks for building when multi-building unit resolution is ambiguous', async () => {
    const { service, prisma } = makeService();
    prisma.membership.findUnique.mockResolvedValue({
      roles: [{ role: 'TENANT_ADMIN' }],
    });
    prisma.building.findMany.mockResolvedValue([
      { id: 'b1', name: 'Torre A' },
      { id: 'b2', name: 'Torre B' },
    ]);

    const result = await service.executeTool(
      'resolve_unit_ref',
      {
        question: 'unidad 101',
        context: {
          tenantId: 'tenant-1',
          userId: 'user-1',
          role: 'TENANT_ADMIN',
        },
      },
      {
        apiKey: 'test-readonly-key',
        tenantId: 'tenant-1',
        userId: 'user-1',
        role: 'TENANT_ADMIN',
      },
    );

    expect(result.responseType).toBe('clarification');
    expect(result.answer).toContain('indiques el edificio');
    expect(result.metadata.needsBuilding).toBe(true);
  });
});
