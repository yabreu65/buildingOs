import { ForbiddenException } from '@nestjs/common';
import { AssistantToolsService } from './tools.service';

describe('AssistantToolsService', () => {
  const previousApiKeys = process.env.ASSISTANT_READONLY_API_KEYS;
  const previousPermissions = process.env.ASSISTANT_TOOLS_ROLE_PERMISSIONS_JSON;

  beforeEach(() => {
    process.env.ASSISTANT_READONLY_API_KEYS = 'test-readonly-key';
    delete process.env.ASSISTANT_TOOLS_ROLE_PERMISSIONS_JSON;
  });

  afterEach(() => {
    process.env.ASSISTANT_READONLY_API_KEYS = previousApiKeys;
    process.env.ASSISTANT_TOOLS_ROLE_PERMISSIONS_JSON = previousPermissions;
  });

  const makeService = () => {
    const prisma = {
      membership: { findUnique: jest.fn() },
      building: { findMany: jest.fn() },
      unit: { findMany: jest.fn(), findUniqueOrThrow: jest.fn() },
      charge: { findMany: jest.fn(), aggregate: jest.fn() },
      payment: { findMany: jest.fn(), aggregate: jest.fn() },
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
        { question: 'tickets', context: { tenantId: 'tenant-body', userId: 'user-1', role: 'TENANT_ADMIN' } },
        { apiKey: 'test-readonly-key', tenantId: 'tenant-header', userId: 'user-1', role: 'TENANT_ADMIN' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies role without tool permission', async () => {
    const { service, prisma } = makeService();
    prisma.membership.findUnique.mockResolvedValue({ roles: [{ role: 'RESIDENT' }] });
    await expect(
      service.executeTool(
        'search_payments',
        { question: 'pagos', context: { tenantId: 'tenant-1', userId: 'user-1', role: 'RESIDENT' } },
        { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'user-1', role: 'RESIDENT' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('asks for building when multi-building unit resolution is ambiguous', async () => {
    const { service, prisma } = makeService();
    prisma.membership.findUnique.mockResolvedValue({ roles: [{ role: 'TENANT_ADMIN' }] });
    prisma.building.findMany.mockResolvedValue([{ id: 'b1', name: 'Torre A' }, { id: 'b2', name: 'Torre B' }]);
    const result = await service.executeTool(
      'resolve_unit_ref',
      { question: 'unidad 101', context: { tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' } },
      { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' },
    );
    expect(result.responseType).toBe('clarification');
    expect(result.metadata.needsBuilding).toBe(true);
  });
});

describe('AssistantToolsService P1', () => {
  const previousApiKeys = process.env.ASSISTANT_READONLY_API_KEYS;
  const previousPermissions = process.env.ASSISTANT_TOOLS_ROLE_PERMISSIONS_JSON;

  beforeEach(() => {
    process.env.ASSISTANT_READONLY_API_KEYS = 'test-readonly-key';
    delete process.env.ASSISTANT_TOOLS_ROLE_PERMISSIONS_JSON;
  });

  afterEach(() => {
    process.env.ASSISTANT_READONLY_API_KEYS = previousApiKeys;
    process.env.ASSISTANT_TOOLS_ROLE_PERMISSIONS_JSON = previousPermissions;
  });

  const makeService = () => {
    const prisma = {
      membership: { findUnique: jest.fn() },
      building: { findMany: jest.fn() },
      unit: { findMany: jest.fn(), findUniqueOrThrow: jest.fn() },
      charge: { findMany: jest.fn(), aggregate: jest.fn() },
      payment: { findMany: jest.fn(), aggregate: jest.fn() },
      ticket: { findMany: jest.fn() },
      unitOccupant: { findMany: jest.fn() },
    } as any;
    const audit = { createLog: jest.fn() } as any;
    const service = new AssistantToolsService(prisma, audit);
    return { service, prisma, audit };
  };

  it('getUnitPayments returns last payment for unit', async () => {
    const { service, prisma } = makeService();
    prisma.membership.findUnique.mockResolvedValue({ roles: [{ role: 'TENANT_ADMIN' }] });
    prisma.building.findMany.mockResolvedValue([{ id: 'b1', name: 'Torre A' }]);
    prisma.unit.findMany.mockResolvedValue([{ id: 'u1', code: '101', label: '101', buildingId: 'b1', building: { name: 'Torre A' } }]);
    const paymentMock = { id: 'p1', unitId: 'u1', amount: 50000, status: 'APPROVED' };
    prisma.payment.findMany.mockResolvedValue([paymentMock]);

    const result = await service.executeTool(
      'get_unit_payments',
      { question: 'Ultimo pago', toolInput: { unitRef: '101', buildingName: 'Torre A', ranking: 1 }, context: { tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' } },
      { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' },
    );

    expect(result.responseType).toBe('list');
  });

  it('denies role without get_unit_payments permission', async () => {
    process.env.ASSISTANT_TOOLS_ROLE_PERMISSIONS_JSON = JSON.stringify({ TENANT_ADMIN: ['tools.search_payments'] });
    const { service, prisma } = makeService();
    prisma.membership.findUnique.mockResolvedValue({ roles: [{ role: 'TENANT_ADMIN' }] });
    await expect(
      service.executeTool('get_unit_payments', { question: 'pago', context: { tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' } }, { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('getUnitBalanceByPeriod returns period evolution', async () => {
    const { service, prisma, audit } = makeService();
    prisma.membership.findUnique.mockResolvedValue({ roles: [{ role: 'TENANT_ADMIN' }] });
    prisma.building.findMany.mockResolvedValue([{ id: 'b1', name: 'Torre A' }]);
    prisma.unit.findMany.mockResolvedValue([{ id: 'u1', code: '101', label: '101', buildingId: 'b1', building: { name: 'Torre A' } }]);
    prisma.charge.aggregate.mockResolvedValue({ _sum: { amount: 100000 } });
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 30000 } });

    const result = await service.executeTool(
      'get_unit_balance_by_period',
      { question: 'Evolucion', toolInput: { unitRef: '101', buildingName: 'Torre A' }, context: { tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' } },
      { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' },
    );

    expect(result.responseType).toBe('list');
    expect(result.metadata.periods).toBeDefined();
  });

  it('analyticsDebtAging returns aging buckets', async () => {
    const { service, prisma, audit } = makeService();
    prisma.membership.findUnique.mockResolvedValue({ roles: [{ role: 'TENANT_ADMIN' }] });
    const chargeMock = { id: 'c1', unitId: 'u1', amount: 50000, dueDate: new Date('2026-01-15'), status: 'PENDING', canceledAt: null, unit: { id: 'u1', label: '101', code: '101', buildingId: 'b1', building: { name: 'Torre A' } }, paymentAllocations: [] };
    prisma.charge.findMany.mockResolvedValue([chargeMock]);

    const result = await service.executeTool(
      'analytics_debt_aging',
      { question: 'Antiguedad', toolInput: { asOf: '2026-04-24' }, context: { tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' } },
      { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' },
    );

    expect(result.responseType).toBe('metric');
    expect(result.metadata.asOf).toBe('2026-04-24');
    expect(result.metadata.buckets).toBeDefined();
  });

  it('analyticsDebtByTower returns sorted buildings', async () => {
    const { service, prisma, audit } = makeService();
    prisma.membership.findUnique.mockResolvedValue({ roles: [{ role: 'TENANT_ADMIN' }] });
    const charge1 = { id: 'c1', unitId: 'u1', amount: 100000, dueDate: new Date('2026-01-15'), status: 'PENDING', canceledAt: null, unit: { id: 'u1', buildingId: 'b1', building: { name: 'Torre A' } }, paymentAllocations: [] };
    const charge2 = { id: 'c2', unitId: 'u2', amount: 50000, dueDate: new Date('2026-01-15'), status: 'PENDING', canceledAt: null, unit: { id: 'u2', buildingId: 'b2', building: { name: 'Torre B' } }, paymentAllocations: [] };
    prisma.charge.findMany.mockResolvedValue([charge1, charge2]);

    const result = await service.executeTool(
      'analytics_debt_by_tower',
      { question: 'Deuda torre', toolInput: { asOf: '2026-04-24' }, context: { tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' } },
      { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' },
    );

    expect(result.responseType).toBe('list');
    const buildings = result.metadata.buildings as Array<{ name: string; totalDebt: number }>;
    expect(buildings[0].name).toBe('Torre A');
  });

  it('search_payments does not use mode', async () => {
    const { service, prisma } = makeService();
    prisma.membership.findUnique.mockResolvedValue({ roles: [{ role: 'TENANT_ADMIN' }] });
    prisma.payment.findMany.mockResolvedValue([]);

    const result = await service.executeTool(
      'search_payments',
      { question: 'pendientes', toolInput: { status: ['SUBMITTED'] }, context: { tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' } },
      { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' },
    );

    expect(result.metadata.status).toContain('SUBMITTED');
    expect(result.metadata).not.toHaveProperty('mode');
  });
});
