import { DashboardService } from './dashboard.service';
import { DashboardPeriod } from './dashboard.dto';
import { PaymentStatus } from '@prisma/client';

describe('DashboardService', () => {
  let service: DashboardService;
  const prisma = {
    building: { findMany: jest.fn() },
    charge: { findMany: jest.fn() },
    payment: {
      aggregate: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    ticket: {
      count: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    unit: { findMany: jest.fn() },
  } as any;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-19T12:00:00.000Z'));
    jest.clearAllMocks();
    service = new DashboardService(prisma);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses Charge.period (not createdAt) and Payment.paidAt for PREVIOUS_MONTH KPIs', async () => {
    prisma.building.findMany.mockResolvedValue([{ id: 'b-1', name: 'Torre 1' }]);
    prisma.charge.findMany
      .mockResolvedValueOnce([
        {
          id: 'charge-1',
          tenantId: 'tenant-1',
          buildingId: 'b-1',
          unitId: 'u-1',
          period: '2026-03',
          amount: 10000,
          createdAt: new Date('2026-04-05T15:00:00.000Z'),
          canceledAt: null,
          paymentAllocations: [],
        },
      ])
      .mockResolvedValueOnce([]);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 3000 } });
    prisma.ticket.count.mockResolvedValue(0);
    prisma.ticket.findMany.mockResolvedValue([]);
    prisma.ticket.groupBy.mockResolvedValue([]);
    prisma.payment.count.mockResolvedValue(0);
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.unit.findMany.mockResolvedValue([]);

    const result = await service.getSummary('tenant-1', {
      period: DashboardPeriod.PREVIOUS_MONTH,
    });

    const chargeWhere = prisma.charge.findMany.mock.calls[0][0].where;
    expect(chargeWhere.period).toBe('2026-03');
    expect(chargeWhere.createdAt).toBeUndefined();

    const paymentWhere = prisma.payment.aggregate.mock.calls[0][0].where;
    expect(paymentWhere.paidAt).toBeDefined();
    expect(paymentWhere.updatedAt).toBeUndefined();
    expect(paymentWhere.status).toEqual({
      in: [PaymentStatus.APPROVED, PaymentStatus.RECONCILED],
    });

    expect(result.kpis.outstandingAmount).toBe(10000);
    expect(result.kpis.collectedAmount).toBe(3000);
    expect(result.kpis.delinquentUnits).toBe(1);
  });

  it('uses explicit periodMonth when provided', async () => {
    prisma.building.findMany.mockResolvedValue([{ id: 'b-1', name: 'Torre 1' }]);
    prisma.charge.findMany.mockResolvedValueOnce([
      {
        id: 'charge-1',
        tenantId: 'tenant-1',
        buildingId: 'b-1',
        unitId: 'u-1',
        period: '2026-02',
        amount: 5000,
        canceledAt: null,
        paymentAllocations: [],
      },
    ]).mockResolvedValueOnce([]);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 1000 } });
    prisma.ticket.count.mockResolvedValue(0);
    prisma.ticket.findMany.mockResolvedValue([]);
    prisma.ticket.groupBy.mockResolvedValue([]);
    prisma.payment.count.mockResolvedValue(0);
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.unit.findMany.mockResolvedValue([]);

    const result = await service.getSummary('tenant-1', {
      periodMonth: '2026-02',
    });

    const chargeWhere = prisma.charge.findMany.mock.calls[0][0].where;
    expect(chargeWhere.period).toBe('2026-02');
    expect(result.metadata.period).toBe('2026-02');
    expect(result.metadata.periodMonth).toBe('2026-02');
  });
});
