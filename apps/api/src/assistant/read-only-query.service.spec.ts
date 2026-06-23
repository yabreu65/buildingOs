import { ForbiddenException } from '@nestjs/common';
import { AssistantReadOnlyQueryService } from './read-only-query.service';

describe('AssistantReadOnlyQueryService', () => {
  const previousApiKeys = process.env.ASSISTANT_READONLY_API_KEYS;

  beforeEach(() => {
    process.env.ASSISTANT_READONLY_API_KEYS = 'test-readonly-key';
  });

  afterEach(() => {
    process.env.ASSISTANT_READONLY_API_KEYS = previousApiKeys;
  });

  const makeService = () => {
    const prisma = {
      membership: {
        findUnique: jest.fn(),
      },
      charge: {
        findMany: jest.fn(),
      },
      payment: {
        count: jest.fn(),
        findMany: jest.fn(),
        aggregate: jest.fn(),
      },
      ticket: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
      unit: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
    } as any;

    const finanzasService = {
      getTenantFinancialSummary: jest.fn(),
      listPendingPayments: jest.fn(),
      getPaymentMetrics: jest.fn(),
    };

    const service = new AssistantReadOnlyQueryService(
      prisma,
      finanzasService as never,
    );
    return { service, prisma, finanzasService };
  };

  it('maps legacy intents to canonical intent and executes one resolver', async () => {
    const { service, prisma, finanzasService } = makeService();

    prisma.membership.findUnique.mockResolvedValue({
      roles: [{ role: 'TENANT_ADMIN' }],
    });
    finanzasService.getTenantFinancialSummary.mockResolvedValue({
      totalCharges: 10000,
      totalPaid: 2500,
      totalOutstanding: 7500,
      delinquentUnitsCount: 1,
      topDelinquentUnits: [
        {
          unitId: 'u-1',
          unitLabel: 'A-101',
          buildingId: 'b-1',
          buildingName: 'Torre Norte',
          outstanding: 7500,
        },
      ],
      currency: 'ARS',
    });

    const result = await service.execute(
      {
        intent: 'admin_arrears_by_building',
        question: 'Mostrame los morosos',
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

    expect(result.answerSource).toBe('live_data');
    expect(result.metadata.intentCode).toBe('GET_OVERDUE_UNITS');
    expect(result.responseType).toBe('list');
    expect(finanzasService.getTenantFinancialSummary).toHaveBeenCalledWith('tenant-1');
    expect(prisma.charge.findMany).not.toHaveBeenCalled();
  });

  it('blocks tenant spoofing mismatch between headers and body context', async () => {
    const { service } = makeService();

    await expect(
      service.execute(
        {
          intentCode: 'GET_OPEN_TICKETS',
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

  it('denies roles outside admin scope', async () => {
    const { service, prisma } = makeService();

    prisma.membership.findUnique.mockResolvedValue({
      roles: [{ role: 'RESIDENT' }],
    });

    await expect(
      service.execute(
        {
          intentCode: 'GET_PENDING_PAYMENTS',
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

  it('filters vacant units with explicit tenantId on Unit', async () => {
    const { service, prisma } = makeService();

    prisma.membership.findUnique.mockResolvedValue({
      roles: [{ role: 'TENANT_ADMIN' }],
    });
    prisma.unit.count.mockResolvedValue(1);
    prisma.unit.findMany.mockResolvedValue([
      { id: 'u1', code: '101', label: '101', building: { name: 'Torre A' } },
    ]);

    const result = await service.execute(
      {
        intentCode: 'GET_VACANT_UNITS',
        question: 'unidades vacantes',
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

    expect(result.metadata.intentCode).toBe('GET_VACANT_UNITS');
    expect(prisma.unit.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 'tenant-1', occupancyStatus: 'VACANT' }),
    }));
    expect(prisma.unit.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 'tenant-1', occupancyStatus: 'VACANT' }),
    }));
  });

  it('resolves tenant_debt aliases to the tenant-wide debt resolver', async () => {
    const { service, prisma, finanzasService } = makeService();

    prisma.membership.findUnique.mockResolvedValue({
      roles: [{ role: 'TENANT_ADMIN' }],
    });
    finanzasService.getTenantFinancialSummary.mockResolvedValue({
      totalCharges: 600000,
      totalPaid: 125432,
      totalOutstanding: 474568,
      delinquentUnitsCount: 18,
      topDelinquentUnits: [],
      currency: 'ARS',
    });

    const result = await service.execute(
      {
        intent: 'admin_debt',
        question: 'deuda total de la administracion',
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

    expect(finanzasService.getTenantFinancialSummary).toHaveBeenCalledWith('tenant-1');
    expect(result.metadata.intentCode).toBe('GET_TENANT_DEBT');
    expect(result.responseType).toBe('summary');
    expect(result.answer).toContain('Deuda total de la administración');
  });

});
