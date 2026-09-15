import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardPeriod } from './dashboard.dto';

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: PrismaService;

  const createPrismaMock = () => ({
    tenant: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ currency: 'ARS' }),
    },
    building: {
      findMany: jest.fn().mockResolvedValue([{ id: 'building-1', name: 'Edificio A' }]),
    },
    charge: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    ticket: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    payment: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    unit: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  });

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 5, 24, 12, 0, 0));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        {
          provide: PrismaService,
          useValue: createPrismaMock(),
        },
      ],
    }).compile();

    service = module.get(DashboardService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('uses Charge.period for YYYY-MM dashboard periods', async () => {
    await service.getSummary('tenant-1', { period: '2026-05' });

    const chargeFindManyMock = prisma.charge.findMany as unknown as jest.Mock;
    const chargeCalls = chargeFindManyMock.mock.calls.map(([args]) => args.where);
    const kpiWhere = chargeCalls.find((where) => where?.period === '2026-05');

    expect(kpiWhere).toMatchObject({
      tenantId: 'tenant-1',
      buildingId: { in: ['building-1'] },
      period: '2026-05',
      canceledAt: null,
    });
    expect(kpiWhere).not.toHaveProperty('createdAt');
  });

  it('normalizes CURRENT_MONTH and PREVIOUS_MONTH to YYYY-MM', async () => {
    await service.getSummary('tenant-1', { period: DashboardPeriod.CURRENT_MONTH });
    await service.getSummary('tenant-1', { period: DashboardPeriod.PREVIOUS_MONTH });

    const chargeFindManyMock = prisma.charge.findMany as unknown as jest.Mock;
    const chargeCalls = chargeFindManyMock.mock.calls.map(([args]) => args.where);

    expect(chargeCalls.some((where) => where?.period === '2026-06')).toBe(true);
    expect(chargeCalls.some((where) => where?.period === '2026-05')).toBe(true);
  });

  it('filters by a specific building only when buildingId is provided', async () => {
    await service.getSummary('tenant-1', { period: '2026-05' });

    const buildingFindManyMock = prisma.building.findMany as unknown as jest.Mock;

    expect(buildingFindManyMock.mock.calls.some(([args]) => args.where?.tenantId === 'tenant-1' && !args.where?.id)).toBe(true);

    await service.getSummary('tenant-1', { period: '2026-05', buildingId: 'building-1' });

    expect(
      buildingFindManyMock.mock.calls.some(([args]) =>
        args.where?.id === 'building-1' && args.where?.tenantId === 'tenant-1',
      ),
    ).toBe(true);
  });

  function chargeFixture(overrides: Partial<{ id: string; amount: number; currency: string; unitId: string; paymentAllocations: unknown[] }> = {}) {
    return {
      id: 'charge-1',
      tenantId: 'tenant-1',
      buildingId: 'building-1',
      unitId: 'unit-1',
      amount: 10000,
      currency: 'ARS',
      period: '2026-05',
      paymentAllocations: [],
      ...overrides,
    };
  }

  function allocationFixture(amount: number, status: string, overrides: Record<string, unknown> = {}) {
    return { id: `alloc-${amount}`, amount, payment: { status, ...overrides }, ...overrides };
  }

  it('KPI single currency: ARS charge with APPROVED+SUBMITTED allocations', async () => {
    (prisma.charge.findMany as unknown as jest.Mock).mockResolvedValue([
      chargeFixture({ amount: 10000, paymentAllocations: [
        allocationFixture(3000, 'APPROVED'),
        allocationFixture(7000, 'SUBMITTED'),
      ] }),
    ]);

    const result = await service.getSummary('tenant-1', { period: '2026-05' });

    expect(result.kpis.outstandingByCurrency).toEqual([{ currency: 'ARS', amountMinor: 7000 }]);
    expect(result.kpis.collectedByCurrency).toEqual([{ currency: 'ARS', amountMinor: 3000 }]);
    expect(result.kpis.collectionRateByCurrency).toEqual([{ currency: 'ARS', rate: 0.3 }]);
    expect(result.kpis.delinquentUnits).toBe(1);
  });

  it('KPI counts one unit with outstanding charges in multiple currencies once', async () => {
    (prisma.charge.findMany as unknown as jest.Mock).mockResolvedValue([
      chargeFixture({ id: 'c-ars', amount: 10000, currency: 'ARS', unitId: 'unit-1' }),
      chargeFixture({ id: 'c-usd', amount: 5000, currency: 'USD', unitId: 'unit-1' }),
    ]);

    const result = await service.getSummary('tenant-1', { period: '2026-05' });

    expect(result.kpis.outstandingByCurrency).toEqual([
      { currency: 'USD', amountMinor: 5000 },
      { currency: 'ARS', amountMinor: 10000 },
    ]);
    expect(result.kpis.delinquentUnits).toBe(1);
  });

  it('KPI multi-currency: ARS + USD + COP buckets stay separate', async () => {
    (prisma.charge.findMany as unknown as jest.Mock).mockResolvedValue([
      chargeFixture({ id: 'c-ars', amount: 10000, currency: 'ARS', unitId: 'u1', paymentAllocations: [
        allocationFixture(4000, 'APPROVED'),
      ] }),
      chargeFixture({ id: 'c-usd', amount: 5000, currency: 'USD', unitId: 'u2', paymentAllocations: [
        allocationFixture(5000, 'RECONCILED'),
      ] }),
      chargeFixture({ id: 'c-cop', amount: 40000, currency: 'COP', unitId: 'u3', paymentAllocations: [] }),
    ]);

    const result = await service.getSummary('tenant-1', { period: '2026-05' });

    expect(result.kpis.outstandingByCurrency).toEqual([
      { currency: 'USD', amountMinor: 0 },
      { currency: 'ARS', amountMinor: 6000 },
      { currency: 'COP', amountMinor: 40000 },
    ]);
    expect(result.kpis.collectedByCurrency).toEqual([
      { currency: 'USD', amountMinor: 5000 },
      { currency: 'ARS', amountMinor: 4000 },
      { currency: 'COP', amountMinor: 0 },
    ]);
    expect(result.kpis.collectionRateByCurrency).toEqual([
      { currency: 'USD', rate: 1 },
      { currency: 'ARS', rate: 0.4 },
      { currency: 'COP', rate: 0 },
    ]);
    expect(result.kpis.delinquentUnits).toBe(2);
  });

  it('KPI CROSS: uses allocation.amount in Charge.currency, never the Payment original share', async () => {
    // Payment USD 5000, Charge ARS 182500, allocation.amount = 182500 ARS,
    // paymentOriginalAmountMinor = 5000 USD. Charge-side outstanding uses ARS only.
    (prisma.charge.findMany as unknown as jest.Mock).mockResolvedValue([
      chargeFixture({ id: 'c-cross', amount: 182500, currency: 'ARS', paymentAllocations: [
        allocationFixture(182500, 'APPROVED', { paymentOriginalAmountMinor: 5000 }),
      ] }),
    ]);

    const result = await service.getSummary('tenant-1', { period: '2026-05' });

    expect(result.kpis.outstandingByCurrency).toEqual([{ currency: 'ARS', amountMinor: 0 }]);
    expect(result.kpis.collectedByCurrency).toEqual([{ currency: 'ARS', amountMinor: 182500 }]);
    expect(result.kpis.collectionRateByCurrency).toEqual([{ currency: 'ARS', rate: 1 }]);
  });

  it('KPI SUBMITTED-only: does not reduce accounting outstanding', async () => {
    (prisma.charge.findMany as unknown as jest.Mock).mockResolvedValue([
      chargeFixture({ amount: 10000, paymentAllocations: [
        allocationFixture(10000, 'SUBMITTED'),
      ] }),
    ]);

    const result = await service.getSummary('tenant-1', { period: '2026-05' });

    expect(result.kpis.outstandingByCurrency).toEqual([{ currency: 'ARS', amountMinor: 10000 }]);
    expect(result.kpis.collectedByCurrency).toEqual([{ currency: 'ARS', amountMinor: 0 }]);
    expect(result.kpis.collectionRateByCurrency).toEqual([{ currency: 'ARS', rate: 0 }]);
    expect(result.kpis.delinquentUnits).toBe(1);
  });

  it('KPI overallocation: collected is bounded by Charge.amount', async () => {
    (prisma.charge.findMany as unknown as jest.Mock).mockResolvedValue([
      chargeFixture({ amount: 10000, paymentAllocations: [
        allocationFixture(12000, 'APPROVED'),
      ] }),
    ]);

    const result = await service.getSummary('tenant-1', { period: '2026-05' });

    expect(result.kpis.outstandingByCurrency).toEqual([{ currency: 'ARS', amountMinor: 0 }]);
    expect(result.kpis.collectedByCurrency).toEqual([{ currency: 'ARS', amountMinor: 10000 }]);
    expect(result.kpis.collectionRateByCurrency).toEqual([{ currency: 'ARS', rate: 1 }]);
  });

  it('KPI multi-currency rates are independent per currency', async () => {
    (prisma.charge.findMany as unknown as jest.Mock).mockResolvedValue([
      chargeFixture({ id: 'c-ars', amount: 10000, currency: 'ARS', unitId: 'u1', paymentAllocations: [
        allocationFixture(5000, 'APPROVED'),
      ] }),
      chargeFixture({ id: 'c-usd', amount: 2000, currency: 'USD', unitId: 'u2', paymentAllocations: [
        allocationFixture(2000, 'RECONCILED'),
      ] }),
      chargeFixture({ id: 'c-cop', amount: 40000, currency: 'COP', unitId: 'u3', paymentAllocations: [
        allocationFixture(10000, 'APPROVED'),
      ] }),
    ]);

    const result = await service.getSummary('tenant-1', { period: '2026-05' });

    expect(result.kpis.collectionRateByCurrency).toEqual([
      { currency: 'USD', rate: 1 },
      { currency: 'ARS', rate: 0.5 },
      { currency: 'COP', rate: 0.25 },
    ]);
    // Never a mixed-currency global ratio: (5000+2000+10000)/(10000+2000+40000).
    expect(result.kpis.collectionRateByCurrency).toHaveLength(3);
  });

  it('KPI empty: no monetary data -> empty buckets, no invented ARS', async () => {
    const result = await service.getSummary('tenant-1', { period: '2026-05' });

    expect(result.kpis.outstandingByCurrency).toEqual([]);
    expect(result.kpis.collectedByCurrency).toEqual([]);
    expect(result.kpis.collectionRateByCurrency).toEqual([]);
    expect(result.kpis.delinquentUnits).toBe(0);
  });

  it('returns a stored UYU charge as a report bucket without throwing', async () => {
    (prisma.charge.findMany as unknown as jest.Mock).mockResolvedValue([
      chargeFixture({ currency: 'UYU', amount: 15000 }),
    ]);

    const result = await service.getSummary('tenant-1', { period: '2026-05' });

    expect(result.kpis.outstandingByCurrency).toEqual([
      { currency: 'UYU', amountMinor: 15000 },
    ]);
  });

  it('keeps USD and stored UYU in separate canonical-first report buckets', async () => {
    (prisma.charge.findMany as unknown as jest.Mock).mockResolvedValue([
      chargeFixture({ id: 'uyu-charge', currency: 'UYU', amount: 15000, unitId: 'unit-1' }),
      chargeFixture({ id: 'usd-charge', currency: 'USD', amount: 5000, unitId: 'unit-2' }),
    ]);

    const result = await service.getSummary('tenant-1', { period: '2026-05' });

    expect(result.kpis.outstandingByCurrency).toEqual([
      { currency: 'USD', amountMinor: 5000 },
      { currency: 'UYU', amountMinor: 15000 },
    ]);
    expect(result.kpis.collectedByCurrency).toEqual([
      { currency: 'USD', amountMinor: 0 },
      { currency: 'UYU', amountMinor: 0 },
    ]);
    expect(result.kpis.collectionRateByCurrency).toEqual([
      { currency: 'USD', rate: 0 },
      { currency: 'UYU', rate: 0 },
    ]);
    expect(result.kpis.delinquentUnits).toBe(2);
  });

  it('keeps a UYU building alert safe and currency-separated', async () => {
    (prisma.charge.findMany as unknown as jest.Mock).mockResolvedValue([
      chargeFixture({ currency: 'UYU', amount: 15000 }),
    ]);

    const result = await service.getSummary('tenant-1', { period: '2026-05' });
    const alert = result.buildingAlerts.find((item) => item.buildingId === 'building-1');

    expect(alert).toMatchObject({
      outstandingByCurrency: [{ currency: 'UYU', amountMinor: 15000 }],
      riskScore: 'LOW',
    });
  });

  it('keeps each pending payment stored currency in the validation queue', async () => {
    (prisma.payment.count as unknown as jest.Mock).mockResolvedValue(1);
    (prisma.payment.findMany as unknown as jest.Mock).mockResolvedValue([
      {
        id: 'payment-usd-1',
        amount: 5000,
        currency: 'USD',
        createdAt: new Date('2026-05-24T12:00:00.000Z'),
        unit: { label: 'A-101', building: { name: 'Edificio A' } },
      },
    ]);

    const result = await service.getSummary('tenant-1', { period: '2026-05' });

    expect(result.queues.paymentsToValidate).toEqual({
      count: 1,
      top: [
        expect.objectContaining({
          id: 'payment-usd-1',
          amount: 5000,
          currency: 'USD',
        }),
      ],
    });
  });

  it('keeps building-alert debt in Charge.currency and excludes submitted allocations', async () => {
    (prisma.charge.findMany as unknown as jest.Mock).mockResolvedValue([
      chargeFixture({
        id: 'ars-charge',
        amount: 10000,
        currency: 'ARS',
        paymentAllocations: [
          allocationFixture(3000, 'APPROVED'),
          allocationFixture(7000, 'SUBMITTED'),
        ],
      }),
      chargeFixture({
        id: 'usd-charge',
        amount: 5000,
        currency: 'USD',
        paymentAllocations: [allocationFixture(1000, 'RECONCILED')],
      }),
    ]);

    const result = await service.getSummary('tenant-1', { period: '2026-05' });
    const alert = result.buildingAlerts.find((item) => item.buildingId === 'building-1');

    expect(alert).toMatchObject({
      outstandingByCurrency: [
        { currency: 'USD', amountMinor: 4000 },
        { currency: 'ARS', amountMinor: 7000 },
      ],
    });
    expect(alert).not.toHaveProperty('outstandingAmount');
  });

  it('keeps building-alert debt currency-safe while risk stays non-monetary', async () => {
    (prisma.building.findMany as unknown as jest.Mock).mockResolvedValue([
      { id: 'building-1', name: 'Edificio A' },
      { id: 'building-2', name: 'Edificio B' },
    ]);
    (prisma.charge.findMany as unknown as jest.Mock).mockResolvedValue([
      chargeFixture({
        id: 'b1-ars',
        buildingId: 'building-1',
        amount: 2000000,
        currency: 'ARS',
      }),
      chargeFixture({
        id: 'b1-usd',
        buildingId: 'building-1',
        amount: 5000,
        currency: 'USD',
      }),
      chargeFixture({
        id: 'b2-ars',
        buildingId: 'building-2',
        amount: 10000,
        currency: 'ARS',
      }),
    ]);
    (prisma.ticket.groupBy as unknown as jest.Mock).mockResolvedValue([
      { buildingId: 'building-2', _count: { id: 2 } },
    ]);

    const result = await service.getSummary('tenant-1', { period: '2026-05' });
    const firstBuilding = result.buildingAlerts.find((item) => item.buildingId === 'building-1');
    const secondBuilding = result.buildingAlerts.find((item) => item.buildingId === 'building-2');

    expect(firstBuilding).toMatchObject({
      outstandingByCurrency: [
        { currency: 'USD', amountMinor: 5000 },
        { currency: 'ARS', amountMinor: 2000000 },
      ],
      riskScore: 'LOW',
    });
    expect(secondBuilding).toMatchObject({
      outstandingByCurrency: [{ currency: 'ARS', amountMinor: 10000 }],
      riskScore: 'MEDIUM',
    });
  });
});
