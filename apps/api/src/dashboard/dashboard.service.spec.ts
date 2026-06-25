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
});
