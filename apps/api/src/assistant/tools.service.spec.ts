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
      unit: { findMany: jest.fn(), findFirst: jest.fn(), findUniqueOrThrow: jest.fn() },
      charge: { findMany: jest.fn(), aggregate: jest.fn() },
      payment: { findMany: jest.fn(), aggregate: jest.fn() },
      ticket: { findMany: jest.fn() },
      unitOccupant: { findMany: jest.fn(), findFirst: jest.fn() },
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

  it('denies role without tool permission (returns controlled error)', async () => {
    const { service, prisma } = makeService();
    prisma.membership.findUnique.mockResolvedValue({ roles: [{ role: 'RESIDENT' }] });
    const result = await service.executeTool(
      'search_payments',
      { question: 'pagos', context: { tenantId: 'tenant-1', userId: 'user-1', role: 'RESIDENT' } },
      { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'user-1', role: 'RESIDENT' },
    );
    expect(result.answerSource).toBe('error');
    expect(result.responseType).toBe('error');
    expect(result.metadata.gatewayOutcome).toBe('forbidden');
  });

  it('allows RESIDENT get_unit_balance only for self-scoped occupied unit', async () => {
    const { service, prisma } = makeService();
    prisma.membership.findUnique.mockResolvedValue({ roles: [{ role: 'RESIDENT' }] });
    prisma.unitOccupant.findFirst.mockResolvedValue({ id: 'occ-1' });
    prisma.unit.findFirst.mockResolvedValue({
      id: 'u1',
      code: '101',
      label: 'Apt 101',
      buildingId: 'b1',
      building: { name: 'Torre A' },
    });
    prisma.unit.findUniqueOrThrow.mockResolvedValue({
      id: 'u1',
      code: '101',
      label: 'Apt 101',
      building: { name: 'Torre A' },
    });
    prisma.charge.findMany.mockResolvedValue([
      { id: 'c1', amount: 50000, paymentAllocations: [] },
    ]);

    const result = await service.executeTool(
      'get_unit_balance',
      {
        question: 'cuánto debo',
        toolInput: { scope: 'self', unitId: 'u1', userId: 'resident-1' },
        context: { tenantId: 'tenant-1', userId: 'resident-1', role: 'RESIDENT' },
      },
      { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'resident-1', role: 'RESIDENT' },
    );

    expect(result.responseType).toBe('summary');
    expect(result.metadata.unitId).toBe('u1');
    expect(result.metadata.outstanding).toBe(50000);
    expect(result.metadata.amount).toBe(50000);
    expect(result.metadata.asOf).toEqual(expect.any(String));
    expect(result.metadata.status).toBe('operativo');
  });

  it('denies RESIDENT get_unit_balance for a unit outside self scope', async () => {
    const { service, prisma } = makeService();
    prisma.membership.findUnique.mockResolvedValue({ roles: [{ role: 'RESIDENT' }] });
    prisma.unitOccupant.findFirst.mockResolvedValue(null);

    const result = await service.executeTool(
      'get_unit_balance',
      {
        question: 'cuánto debo',
        toolInput: { scope: 'self', unitId: 'other-unit', userId: 'resident-1' },
        context: { tenantId: 'tenant-1', userId: 'resident-1', role: 'RESIDENT' },
      },
      { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'resident-1', role: 'RESIDENT' },
    );

    expect(result.answerSource).toBe('error');
    expect(result.responseType).toBe('error');
    expect(result.metadata.gatewayOutcome).toBe('forbidden');
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
      unit: { findMany: jest.fn(), findFirst: jest.fn(), findUniqueOrThrow: jest.fn() },
      charge: { findMany: jest.fn(), aggregate: jest.fn() },
      payment: { findMany: jest.fn(), aggregate: jest.fn() },
      ticket: { findMany: jest.fn() },
      unitOccupant: { findMany: jest.fn(), findFirst: jest.fn() },
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

  it('denies role without get_unit_payments permission (returns controlled error)', async () => {
    process.env.ASSISTANT_TOOLS_ROLE_PERMISSIONS_JSON = JSON.stringify({ TENANT_ADMIN: ['tools.search_payments'] });
    const { service, prisma } = makeService();
    prisma.membership.findUnique.mockResolvedValue({ roles: [{ role: 'TENANT_ADMIN' }] });
    const result = await service.executeTool(
      'get_unit_payments',
      { question: 'pago', context: { tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' } },
      { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' },
    );
    expect(result.answerSource).toBe('error');
    expect(result.responseType).toBe('error');
    expect(result.metadata.gatewayOutcome).toBe('forbidden');
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

  it('search_payments mode=last_payment returns latest building payment metadata', async () => {
    const { service, prisma } = makeService();
    prisma.membership.findUnique.mockResolvedValue({ roles: [{ role: 'TENANT_ADMIN' }] });
    prisma.payment.findMany.mockResolvedValue([
      {
        id: 'p1',
        amount: 152526,
        currency: 'ARS',
        status: 'APPROVED',
        paidAt: new Date('2024-05-01T03:00:00.000Z'),
        createdAt: new Date('2024-05-01T03:00:00.000Z'),
        unit: { label: '101', code: '101', building: { name: 'Torre A' } },
      },
    ]);

    const result = await service.executeTool(
      'search_payments',
      {
        question: 'ultimo pago recibido global del edificio',
        toolInput: { mode: 'last_payment', buildingId: 'b1', ranking: 1 },
        context: { tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' },
      },
      { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' },
    );

    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          buildingId: 'b1',
        }),
        take: 1,
      }),
    );
    expect(result.responseType).toBe('summary');
    expect(result.metadata.lastPaymentAmount).toBe(152526);
    expect(result.metadata.lastPaymentDate).toBe('2024-05-01');
    expect(result.metadata.towerName).toBe('Torre A');
    expect(result.metadata.status).toBe('APPROVED');
  });
});

describe('AssistantToolsService - Anti-Knowledge-Fallback Guard', () => {
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
      charge: { findMany: jest.fn(), aggregate: jest.fn() },
      payment: { findMany: jest.fn(), aggregate: jest.fn() },
      ticket: { findMany: jest.fn() },
      unitOccupant: { findMany: jest.fn() },
    } as any;
    const audit = { createLog: jest.fn() } as any;
    const processSearch = {} as any;
    const crossQuery = {} as any;
    const service = new AssistantToolsService(prisma, audit, processSearch, crossQuery);
    return { service, prisma, audit };
  };

  it('returns controlled error when tool throws ForbiddenException (gateway 403)', async () => {
    const { service, prisma } = makeService();
    const ForbiddenException = require('@nestjs/common').ForbiddenException;
    prisma.membership.findUnique.mockResolvedValue({ roles: [{ role: 'TENANT_ADMIN' }] });
    prisma.building.findMany.mockRejectedValue(new ForbiddenException('Access denied'));

    const result = await service.executeTool(
      'resolve_unit_ref',
      { question: 'unidad 101', context: { tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' } },
      { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' },
    );

    expect(result.answerSource).toBe('error');
    expect(result.responseType).toBe('error');
    expect(result.metadata.gatewayOutcome).toBe('forbidden');
    expect(result.metadata.traceId).toBeDefined();
    expect(result.answer).toContain('No pude obtener datos operativos');
  });

  it('returns controlled error when tool throws BadRequestException (invalid payload)', async () => {
    const { service, prisma } = makeService();
    const BadRequestException = require('@nestjs/common').BadRequestException;
    prisma.membership.findUnique.mockResolvedValue({ roles: [{ role: 'TENANT_ADMIN' }] });
    prisma.building.findMany.mockRejectedValue(new BadRequestException('Invalid input'));

    const result = await service.executeTool(
      'resolve_unit_ref',
      { question: 'unidad 101', context: { tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' } },
      { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' },
    );

    expect(result.answerSource).toBe('error');
    expect(result.responseType).toBe('error');
    expect(result.metadata.gatewayOutcome).toBe('invalid_request');
  });

  it('returns controlled error when tool throws timeout error', async () => {
    const { service, prisma } = makeService();
    prisma.membership.findUnique.mockResolvedValue({ roles: [{ role: 'TENANT_ADMIN' }] });
    prisma.building.findMany.mockRejectedValue(new Error('Query timeout exceeded'));

    const result = await service.executeTool(
      'resolve_unit_ref',
      { question: 'unidad 101', context: { tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' } },
      { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' },
    );

    expect(result.answerSource).toBe('error');
    expect(result.responseType).toBe('error');
    expect(result.metadata.gatewayOutcome).toBe('timeout');
  });

  it('returns controlled error when tool throws unavailable error', async () => {
    const { service, prisma } = makeService();
    prisma.membership.findUnique.mockResolvedValue({ roles: [{ role: 'TENANT_ADMIN' }] });
    prisma.building.findMany.mockRejectedValue(new Error('Service unavailable'));

    const result = await service.executeTool(
      'resolve_unit_ref',
      { question: 'unidad 101', context: { tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' } },
      { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' },
    );

    expect(result.answerSource).toBe('error');
    expect(result.responseType).toBe('error');
    expect(result.metadata.gatewayOutcome).toBe('unavailable');
  });

  it('returns live_data when tool succeeds (snapshot/live_data)', async () => {
    const { service, prisma } = makeService();
    prisma.membership.findUnique.mockResolvedValue({ roles: [{ role: 'TENANT_ADMIN' }] });
    prisma.building.findMany.mockResolvedValue([{ id: 'b1', name: 'Torre A' }]);
    prisma.unit.findMany.mockResolvedValue([{ id: 'u1', code: '101', label: '101', buildingId: 'b1', building: { name: 'Torre A' } }]);
    prisma.ticket.findMany.mockResolvedValue([
      { id: 't1', title: 'Leak in apartment 5B', building: { name: 'Torre A' }, status: 'OPEN', createdAt: new Date() },
    ]);

    const result = await service.executeTool(
      'search_tickets',
      { question: 'tickets abiertos', context: { tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' } },
      { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' },
    );

    expect(result.answerSource).toBe('live_data');
    expect(result.responseType).toBe('list');
    expect(result.metadata.gatewayOutcome).toBeUndefined();
  });

  it('NEVER returns knowledge as answerSource for operational tools', async () => {
    const { service, prisma } = makeService();
    prisma.membership.findUnique.mockResolvedValue({ roles: [{ role: 'TENANT_ADMIN' }] });
    prisma.building.findMany.mockRejectedValue(new Error('Database unavailable'));

    const result = await service.executeTool(
      'resolve_unit_ref',
      { question: 'unidad 101', context: { tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' } },
      { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' },
    );

    expect(result.answerSource).not.toBe('knowledge');
    expect(result.answerSource).not.toBe('fallback');
    expect(result.answerSource).toBe('error');
  });

  it('includes traceId in controlled error for debugging', async () => {
    const { service, prisma } = makeService();
    const ForbiddenException = require('@nestjs/common').ForbiddenException;
    prisma.membership.findUnique.mockResolvedValue({ roles: [{ role: 'TENANT_ADMIN' }] });
    prisma.building.findMany.mockRejectedValue(new ForbiddenException('Access denied'));

    const result = await service.executeTool(
      'resolve_unit_ref',
      { question: 'unidad 101', context: { tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' } },
      { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'user-1', role: 'TENANT_ADMIN' },
    );

    expect(result.metadata.traceId).toMatch(/^[A-Z0-9]+$/);
    expect(result.answer).toContain(result.metadata.traceId);
  });
});
