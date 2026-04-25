import { PaymentStatus, UnitOccupantRole } from '@prisma/client';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const prisma = {
    charge: {
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
    payment: {
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    paymentAllocation: {
      findMany: jest.fn(),
    },
    unitOccupant: {
      findMany: jest.fn(),
    },
  } as any;

  let service: ReportsService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-19T12:00:00.000Z'));
    jest.clearAllMocks();
    service = new ReportsService(prisma);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns debt for last 3 complete periods excluding current month', async () => {
    const chargesByPeriod: Record<string, number> = {
      '2026-01': 10000,
      '2026-02': 12000,
      '2026-03': 9000,
    };
    const paidByPeriod: Record<string, number> = {
      '2026-01': 3000,
      '2026-02': 4000,
      '2026-03': 5000,
    };

    prisma.charge.aggregate.mockImplementation(async ({ where }: any) => ({
      _sum: { amount: chargesByPeriod[where.period] || 0 },
    }));

    prisma.payment.aggregate.mockImplementation(async ({ where }: any) => {
      const month = String(where.paidAt.gte.getMonth() + 1).padStart(2, '0');
      const period = `${where.paidAt.gte.getFullYear()}-${month}`;
      return { _sum: { amount: paidByPeriod[period] || 0 } };
    });

    const result = await service.getDebtSummary('tenant-1', {
      lastMonths: 3,
      excludeCurrent: true,
    });

    expect(result.periods).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(result.debtByPeriod).toEqual({
      '2026-01': 7000,
      '2026-02': 8000,
      '2026-03': 4000,
    });
    expect(result.totalDebt).toBe(19000);
  });

  it('calculates overdue using dueDate and approved allocations only', async () => {
    prisma.charge.findMany.mockResolvedValue([
      {
        id: 'charge-1',
        buildingId: 'building-1',
        unitId: 'unit-1',
        period: '2026-03',
        amount: 1000,
        dueDate: new Date('2026-03-05T00:00:00.000Z'),
        building: { id: 'building-1', name: 'Torre Sur' },
        unit: { id: 'unit-1', label: 'A-101', code: 'A101' },
        paymentAllocations: [
          { amount: 400, payment: { status: PaymentStatus.APPROVED } },
          { amount: 100, payment: { status: PaymentStatus.SUBMITTED } },
        ],
      },
    ]);

    prisma.unitOccupant.findMany.mockResolvedValue([
      {
        unitId: 'unit-1',
        memberId: 'member-1',
        role: UnitOccupantRole.OWNER,
        member: { name: 'Juan Pérez' },
      },
    ]);
    prisma.payment.groupBy.mockResolvedValue([
      {
        unitId: 'unit-1',
        _max: { paidAt: new Date('2026-03-11T12:00:00.000Z') },
      },
    ]);
    prisma.paymentAllocation.findMany.mockResolvedValue([]);

    const result = await service.getDebtAgingReport('tenant-1', {
      asOf: '2026-04-19',
    });

    expect(result.totalOverdue).toBe(600);
    expect(result.buckets['31_60']).toBe(600);
    expect(result.unitsMorosas).toBe(1);
    expect(result.rowsByUnit[0]).toMatchObject({
      unitId: 'unit-1',
      overdueTotal: 600,
      bucket: '31_60',
      oldestUnpaidPeriod: '2026-03',
      responsable: {
        memberId: 'member-1',
        name: 'Juan Pérez',
        role: UnitOccupantRole.OWNER,
      },
    });
  });

  it('assigns 31_60 bucket for 40 overdue days', async () => {
    prisma.charge.findMany.mockResolvedValue([
      {
        id: 'charge-2',
        buildingId: 'building-1',
        unitId: 'unit-2',
        period: '2026-03',
        amount: 2000,
        dueDate: new Date('2026-03-10T00:00:00.000Z'),
        building: { id: 'building-1', name: 'Torre Norte' },
        unit: { id: 'unit-2', label: 'B-202', code: 'B202' },
        paymentAllocations: [],
      },
    ]);

    prisma.unitOccupant.findMany.mockResolvedValue([]);
    prisma.payment.groupBy.mockResolvedValue([]);
    prisma.paymentAllocation.findMany.mockResolvedValue([]);

    const result = await service.getDebtAgingReport('tenant-1', {
      asOf: '2026-04-19',
    });

    expect(result.rowsByUnit[0]?.bucket).toBe('31_60');
    expect(result.buckets['31_60']).toBe(2000);
  });

  it('groups overdue debt by unit and period with real allocations', async () => {
    prisma.charge.findMany.mockResolvedValue([
      {
        id: 'charge-1',
        buildingId: 'building-1',
        unitId: 'unit-1',
        period: '2026-02',
        amount: 1500,
        dueDate: new Date('2026-02-10T00:00:00.000Z'),
        building: { id: 'building-1', name: 'Torre Norte' },
        unit: { id: 'unit-1', label: '302', code: '302' },
        paymentAllocations: [{ amount: 500, payment: { status: PaymentStatus.APPROVED } }],
      },
      {
        id: 'charge-2',
        buildingId: 'building-1',
        unitId: 'unit-1',
        period: '2026-03',
        amount: 1000,
        dueDate: new Date('2026-03-05T00:00:00.000Z'),
        building: { id: 'building-1', name: 'Torre Norte' },
        unit: { id: 'unit-1', label: '302', code: '302' },
        paymentAllocations: [],
      },
    ]);
    prisma.unitOccupant.findMany.mockResolvedValue([]);
    prisma.payment.groupBy.mockResolvedValue([]);
    prisma.paymentAllocation.findMany.mockResolvedValue([]);

    const result = await service.getDebtByPeriodReport('tenant-1', {
      asOf: '2026-04-19',
    });

    expect(result.rowsByUnit).toHaveLength(1);
    expect(result.rowsByUnit[0]?.totalOverdue).toBe(2000);
    expect(result.rowsByUnit[0]?.periods).toEqual([
      {
        period: '2026-02',
        dueDate: '2026-02-09',
        charged: 1500,
        allocatedPaid: 500,
        outstanding: 1000,
      },
      {
        period: '2026-03',
        dueDate: '2026-03-04',
        charged: 1000,
        allocatedPaid: 0,
        outstanding: 1000,
      },
    ]);
  });
});
