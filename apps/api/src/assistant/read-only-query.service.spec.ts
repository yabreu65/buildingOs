import { ForbiddenException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { AssistantReadOnlyQueryService } from './read-only-query.service';
import { AssistantDebtCalculatorService } from './assistant-debt-calculator.service';

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

    const tenantDebtService = {
      resolveTenantDebtSummary: jest.fn(),
    };

    const service = new AssistantReadOnlyQueryService(
      prisma,
      new AssistantDebtCalculatorService(),
      tenantDebtService as never,
    );
    return { service, prisma, tenantDebtService };
  };

  it('maps legacy intents to canonical intent and executes one resolver', async () => {
    const { service, prisma } = makeService();

    prisma.membership.findUnique.mockResolvedValue({
      roles: [{ role: 'TENANT_ADMIN' }],
    });
    prisma.charge.findMany.mockResolvedValue([
      {
        id: 'c-1',
        unitId: 'u-1',
        amount: 10000,
        paymentAllocations: [
          {
            amount: 2500,
            payment: { status: PaymentStatus.APPROVED },
          },
        ],
        unit: {
          id: 'u-1',
          label: 'A-101',
          building: { name: 'Torre Norte' },
        },
      },
    ]);

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
    expect(prisma.charge.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.payment.count).not.toHaveBeenCalled();
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
    const { service, prisma, tenantDebtService } = makeService();

    prisma.membership.findUnique.mockResolvedValue({
      roles: [{ role: 'TENANT_ADMIN' }],
    });
    tenantDebtService.resolveTenantDebtSummary.mockResolvedValue({
      totalDebt: 474568,
      currency: 'ARS',
      chargeCount: 18,
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

    expect(tenantDebtService.resolveTenantDebtSummary).toHaveBeenCalledWith('tenant-1');
    expect(result.metadata.intentCode).toBe('GET_TENANT_DEBT');
    expect(result.responseType).toBe('summary');
    expect(result.answer).toContain('Deuda total de la administración');
  });

});
