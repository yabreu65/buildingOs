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
      charge: { findMany: jest.fn() },
      payment: { findMany: jest.fn() },
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

    await expect(
      service.executeTool(
        'get_unit_balance',
        {
          question: 'cuánto debo',
          toolInput: { scope: 'self', unitId: 'other-unit', userId: 'resident-1' },
          context: { tenantId: 'tenant-1', userId: 'resident-1', role: 'RESIDENT' },
        },
        { apiKey: 'test-readonly-key', tenantId: 'tenant-1', userId: 'resident-1', role: 'RESIDENT' },
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
        building: { name: 'Torre A' },
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
