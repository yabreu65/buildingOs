import { ForbiddenException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
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

    const service = new AssistantReadOnlyQueryService(prisma);
    return { service, prisma };
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
});
