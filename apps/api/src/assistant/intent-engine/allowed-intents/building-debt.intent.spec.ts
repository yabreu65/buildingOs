import { BadRequestException } from '@nestjs/common';
import { ChargeStatus, PaymentStatus } from '@prisma/client';
import { buildingDebtIntent, buildChargePeriodFilter } from './building-debt.intent';

describe('buildingDebtIntent period handling', () => {
  const referenceDate = new Date('2026-06-24T12:00:00.000Z');

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(referenceDate);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  function buildPrismaMock(charges: unknown[] = []) {
    return {
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ currency: 'ARS' }),
      },
      charge: {
        findMany: jest.fn().mockResolvedValue(charges),
      },
    };
  }

  function charge(overrides: {
    unitId: string;
    amount: number;
    currency?: string;
    dueDate?: Date;
    allocations?: Array<{ amount: number; payment?: { status?: PaymentStatus | string; canceledAt?: Date | string | null } | null }>;
  }) {
    return {
      unitId: overrides.unitId,
      amount: overrides.amount,
      status: ChargeStatus.PENDING,
      currency: overrides.currency ?? 'ARS',
      dueDate: overrides.dueDate ?? new Date('2026-01-01T00:00:00.000Z'),
      unit: { code: `code-${overrides.unitId}`, label: `Label ${overrides.unitId}` },
      paymentAllocations: overrides.allocations ?? [],
    };
  }

  it('maps closed_months relative ranges to Prisma period IN filters', async () => {
    const prisma = buildPrismaMock();

    await buildingDebtIntent.executor({
      tenantId: 'tenant-1',
      entityIds: { buildingId: 'building-1' },
      filters: {
        period: {
          kind: 'relative_range',
          amount: 5,
          unit: 'month',
          mode: 'closed_months',
          month: null,
          year: null,
          offset: null,
          startMonth: null,
          startYear: null,
          endMonth: null,
          endYear: null,
        },
      },
      pagination: { limit: 20 },
      prisma: prisma as never,
    });

    expect(prisma.charge.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        period: {
          in: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'],
        },
      }),
    }));
  });

  it('maps including_current relative ranges to Prisma period IN filters', async () => {
    const prisma = buildPrismaMock();

    await buildingDebtIntent.executor({
      tenantId: 'tenant-1',
      entityIds: { buildingId: 'building-1' },
      filters: {
        period: {
          kind: 'relative_range',
          amount: 5,
          unit: 'month',
          mode: 'including_current',
          month: null,
          year: null,
          offset: null,
          startMonth: null,
          startYear: null,
          endMonth: null,
          endYear: null,
        },
      },
      pagination: { limit: 20 },
      prisma: prisma as never,
    });

    expect(prisma.charge.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        period: {
          in: ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
        },
      }),
    }));
  });

  it('keeps direct period strings unchanged', async () => {
    const prisma = buildPrismaMock();

    await buildingDebtIntent.executor({
      tenantId: 'tenant-1',
      entityIds: { buildingId: 'building-1' },
      filters: { period: '2026-06' },
      pagination: { limit: 20 },
      prisma: prisma as never,
    });

    expect(prisma.charge.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        period: '2026-06',
      }),
    }));
  });

  it('keeps canonical current_month periods as the current YYYY-MM string', async () => {
    const prisma = buildPrismaMock();

    await buildingDebtIntent.executor({
      tenantId: 'tenant-1',
      entityIds: { buildingId: 'building-1' },
      filters: {
        period: {
          kind: 'current_month',
          amount: null,
          unit: null,
          mode: null,
          month: null,
          year: null,
          startMonth: null,
          startYear: null,
          endMonth: null,
          endYear: null,
        },
      },
      pagination: { limit: 20 },
      prisma: prisma as never,
    });

    expect(prisma.charge.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        period: '2026-06',
      }),
    }));
  });

  it('does not filter accumulated debt by period', () => {
    expect(buildChargePeriodFilter('accumulated', referenceDate)).toBeUndefined();
    expect(buildChargePeriodFilter({
      kind: 'accumulated',
      amount: null,
      unit: null,
      mode: null,
      month: null,
      year: null,
      startMonth: null,
      startYear: null,
      endMonth: null,
      endYear: null,
    }, referenceDate)).toBeUndefined();
  });

  it('rejects relative_range queries with unknown mode before prisma execution', async () => {
    const prisma = buildPrismaMock();

    await expect(
      buildingDebtIntent.executor({
        tenantId: 'tenant-1',
        entityIds: { buildingId: 'building-1' },
        filters: {
          period: {
            kind: 'relative_range',
            amount: 5,
            unit: 'month',
            mode: 'unknown',
            month: null,
            year: null,
            offset: null,
            startMonth: null,
            startYear: null,
            endMonth: null,
            endYear: null,
          },
        },
        pagination: { limit: 20 },
        prisma: prisma as never,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.charge.findMany).not.toHaveBeenCalled();
  });

  it('loads payment canceledAt and uses canonical outstanding in currency buckets and unit output', async () => {
    const prisma = buildPrismaMock([
      charge({
        unitId: 'unit-approved-canceled',
        amount: 10000,
        currency: 'USD',
        allocations: [{ amount: 10000, payment: { status: PaymentStatus.APPROVED, canceledAt: new Date('2026-01-01') } }],
      }),
      charge({
        unitId: 'unit-reconciled-canceled',
        amount: 12000,
        currency: 'USD',
        allocations: [{ amount: 12000, payment: { status: PaymentStatus.RECONCILED, canceledAt: '2026-01-02T00:00:00.000Z' } }],
      }),
      charge({
        unitId: 'unit-active',
        amount: 10000,
        currency: 'COP',
        allocations: [
          { amount: 3000, payment: { status: PaymentStatus.APPROVED, canceledAt: null } },
          { amount: 2000, payment: { status: PaymentStatus.RECONCILED, canceledAt: null } },
          { amount: 4000, payment: { status: PaymentStatus.SUBMITTED, canceledAt: null } },
          { amount: 1000, payment: { status: PaymentStatus.REJECTED, canceledAt: null } },
        ],
      }),
    ]);

    const result = await buildingDebtIntent.executor({
      tenantId: 'tenant-1',
      entityIds: { buildingId: 'building-1' },
      filters: {},
      pagination: { limit: 20 },
      prisma: prisma as never,
    });

    expect(prisma.charge.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        paymentAllocations: expect.objectContaining({
          include: expect.objectContaining({
            payment: { select: { status: true, canceledAt: true } },
          }),
        }),
      }),
    }));
    expect(result.data).toEqual(expect.objectContaining({
      outstandingByCurrency: [
        { currency: 'USD', amountMinor: 22000 },
        { currency: 'COP', amountMinor: 5000 },
      ],
      totalUnits: 3,
    }));
    expect((result.data as { byUnit: Array<{ label: string; remainingDebtByCurrency: unknown[] }> }).byUnit).toEqual(expect.arrayContaining([
      { label: 'Label unit-approved-canceled', unitCode: 'code-unit-approved-canceled', remainingDebtByCurrency: [{ currency: 'USD', amountMinor: 10000 }] },
      { label: 'Label unit-reconciled-canceled', unitCode: 'code-unit-reconciled-canceled', remainingDebtByCurrency: [{ currency: 'USD', amountMinor: 12000 }] },
      { label: 'Label unit-active', unitCode: 'code-unit-active', remainingDebtByCurrency: [{ currency: 'COP', amountMinor: 5000 }] },
    ]));
  });
});
