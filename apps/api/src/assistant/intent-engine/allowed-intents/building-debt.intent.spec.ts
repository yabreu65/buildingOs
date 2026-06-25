import { BadRequestException } from '@nestjs/common';
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

  function buildPrismaMock() {
    return {
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ currency: 'ARS' }),
      },
      charge: {
        findMany: jest.fn().mockResolvedValue([]),
      },
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
});
