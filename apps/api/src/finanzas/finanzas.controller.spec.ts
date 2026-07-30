import { ForbiddenException } from '@nestjs/common';
import { FinanzasController } from './finanzas.controller';
import type { AuthenticatedRequest } from '../common/types/request.types';
import type {
  BuildingDelinquencyResponseDto,
  FinancialSummaryDto,
  MonthlyTrendDto,
} from './finanzas.dto';

type SummaryArgs = Parameters<FinanzasController['getBuildingFinancialSummary']>;
type TrendArgs = Parameters<FinanzasController['getFinanceTrend']>;
type DelinquencyArgs = Parameters<FinanzasController['getBuildingDelinquency']>;

const stubReq = (
  roles: string[],
  overrides: Record<string, unknown> = {},
): AuthenticatedRequest =>
  ({
    tenantId: 'tenant-1',
    user: {
      id: 'user-1',
      email: 'admin@test.com',
      membershipId: 'member-1',
      roles,
    },
    ...overrides,
  }) as AuthenticatedRequest;

describe('FinanzasController administrative portal access', () => {
  let controller: FinanzasController;
  let service: {
    getBuildingFinancialSummary: jest.Mock;
    getFinanceTrend: jest.Mock;
    getBuildingDelinquency: jest.Mock;
  };

  beforeEach(() => {
    service = {
      getBuildingFinancialSummary: jest.fn(),
      getFinanceTrend: jest.fn(),
      getBuildingDelinquency: jest.fn(),
    };

    controller = new FinanzasController(
      service as never,
      { importExpensesFromRows: jest.fn() } as never,
    );
  });

  it('fails closed for residents, invalid headers, empty roles and unknown roles before any service call', async () => {
    const summaryArgs: SummaryArgs = [
      { buildingId: 'building-1' },
      { period: '2026-05' },
      stubReq(['RESIDENT']),
    ];
    const trendArgs: TrendArgs = [
      { buildingId: 'building-1' },
      { months: 6 },
      stubReq(['RESIDENT']),
    ];
    const delinquencyArgs: DelinquencyArgs = [
      { buildingId: 'building-1' },
      { period: '2026-05', page: 1, pageSize: 10 } as never,
      stubReq(['RESIDENT']),
    ];

    await expect(controller.getBuildingFinancialSummary(...summaryArgs)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.getFinanceTrend(...trendArgs)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.getBuildingDelinquency(...delinquencyArgs)).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      controller.getBuildingFinancialSummary(
        { buildingId: 'building-1' },
        { period: '2026-05' },
        stubReq(['RESIDENT']),
        'resident',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      controller.getFinanceTrend(
        { buildingId: 'building-1' },
        { months: 6 },
        stubReq(['RESIDENT']),
        'admin',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      controller.getBuildingDelinquency(
        { buildingId: 'building-1' },
        { period: '2026-05', page: 1, pageSize: 10 } as never,
        stubReq(['RESIDENT']),
        'admin ',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      controller.getFinanceTrend(
        { buildingId: 'building-1' },
        { months: 6 },
        stubReq([]),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      controller.getBuildingDelinquency(
        { buildingId: 'building-1' },
        { period: '2026-05', page: 1, pageSize: 10 } as never,
        stubReq(['MANAGER']),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(service.getBuildingFinancialSummary).not.toHaveBeenCalled();
    expect(service.getFinanceTrend).not.toHaveBeenCalled();
    expect(service.getBuildingDelinquency).not.toHaveBeenCalled();
  });

  it('allows administrative roles with canonical admin context and preserves the no-header compatible path', async () => {
    const summary: FinancialSummaryDto = {
      totalCharges: 100,
      totalPaid: 50,
      totalOutstanding: 50,
      delinquentUnitsCount: 1,
      topDelinquentUnits: [],
      currency: 'ARS',
      period: '2026-05',
      buildingId: 'building-1',
    };
    const trend = [] as MonthlyTrendDto[];
    const delinquency = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
      totalPages: 0,
      summary: {
        totalUnits: 0,
        delinquentUnits: 0,
        totalOutstanding: 0,
        currency: 'ARS',
      },
    } as BuildingDelinquencyResponseDto;

    service.getBuildingFinancialSummary.mockResolvedValue(summary);
    service.getFinanceTrend.mockResolvedValue(trend);
    service.getBuildingDelinquency.mockResolvedValue(delinquency);

    await expect(
      controller.getBuildingFinancialSummary(
        { buildingId: 'building-1' },
        { period: '2026-05' },
        stubReq(['TENANT_ADMIN']),
      ),
    ).resolves.toBe(summary);

    await expect(
      controller.getFinanceTrend(
        { buildingId: 'building-1' },
        { months: 6 },
        stubReq(['SUPER_ADMIN'], { headers: { 'x-portal-context': 'admin' } }),
        'admin',
      ),
    ).resolves.toBe(trend);

    await expect(
      controller.getBuildingDelinquency(
        { buildingId: 'building-1' },
        { period: '2026-05', page: 1, pageSize: 10 } as never,
        stubReq(['RESIDENT', 'TENANT_ADMIN']),
      ),
    ).resolves.toBe(delinquency);

    await expect(
      controller.getFinanceTrend(
        { buildingId: 'building-1' },
        { months: 6 },
        stubReq(['RESIDENT', 'TENANT_ADMIN'], { headers: { 'x-portal-context': 'admin' } }),
        'admin',
      ),
    ).resolves.toBe(trend);

    expect(service.getBuildingFinancialSummary).toHaveBeenCalledWith(
      'tenant-1',
      'building-1',
      '2026-05',
    );
    expect(service.getFinanceTrend).toHaveBeenCalledWith(
      'tenant-1',
      'building-1',
      6,
    );
    expect(service.getBuildingDelinquency).toHaveBeenCalledWith(
      'tenant-1',
      'building-1',
      { period: '2026-05', page: 1, pageSize: 10 },
    );
  });
});
