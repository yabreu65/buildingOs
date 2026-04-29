import { useQuery } from '@tanstack/react-query';
import {
  useDashboardSummary,
  useDebtSummary,
  useDebtAging,
  useDebtByPeriod,
  useBuildingList,
} from './useDashboardSummary';
import {
  getDashboardSummary,
  getDebtSummary,
  getDebtAging,
  getDebtByPeriod,
} from '../services/dashboard.api';
import { fetchBuildings } from '@/features/buildings/services/buildings.api';

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
}));

jest.mock('../services/dashboard.api', () => ({
  getDashboardSummary: jest.fn(),
  getDebtSummary: jest.fn(),
  getDebtAging: jest.fn(),
  getDebtByPeriod: jest.fn(),
}));

jest.mock('@/features/buildings/services/buildings.api', () => ({
  fetchBuildings: jest.fn(),
}));

describe('useDashboardSummary hooks', () => {
  const useQueryMock = useQuery as jest.Mock;
  const getDashboardSummaryMock = getDashboardSummary as jest.Mock;
  const getDebtSummaryMock = getDebtSummary as jest.Mock;
  const getDebtAgingMock = getDebtAging as jest.Mock;
  const getDebtByPeriodMock = getDebtByPeriod as jest.Mock;
  const fetchBuildingsMock = fetchBuildings as jest.Mock;

  beforeEach(() => {
    useQueryMock.mockReset();
    getDashboardSummaryMock.mockReset();
    getDebtSummaryMock.mockReset();
    getDebtAgingMock.mockReset();
    getDebtByPeriodMock.mockReset();
    fetchBuildingsMock.mockReset();
    useQueryMock.mockReturnValue({ data: null });
  });

  it('configures useDashboardSummary with tenant key and enabled flag', async () => {
    useDashboardSummary('tenant-1', {
      period: 'PREVIOUS_MONTH' as any,
      periodMonth: '2026-04',
      buildingId: 'b-1',
    });
    const config = useQueryMock.mock.calls[0][0];

    expect(config.queryKey).toEqual([
      'dashboard',
      'tenant-1',
      'PREVIOUS_MONTH',
      '2026-04',
      'b-1',
    ]);
    expect(config.enabled).toBe(true);

    getDashboardSummaryMock.mockResolvedValue({});
    await config.queryFn();
    expect(getDashboardSummaryMock).toHaveBeenCalledWith('tenant-1', {
      period: 'PREVIOUS_MONTH',
      periodMonth: '2026-04',
      buildingId: 'b-1',
    });
  });

  it('does not enable debt summary query without tenantId', () => {
    useDebtSummary(undefined, {});
    const config = useQueryMock.mock.calls[0][0];

    expect(config.enabled).toBe(false);
    expect(config.queryKey).toEqual([
      'dashboard-debt-summary',
      undefined,
      undefined,
      3,
      true,
    ]);
  });

  it('uses default debt summary params in queryFn', async () => {
    useDebtSummary('tenant-1', { buildingId: 'b-1' });
    const config = useQueryMock.mock.calls[0][0];

    getDebtSummaryMock.mockResolvedValue({});
    await config.queryFn();

    expect(getDebtSummaryMock).toHaveBeenCalledWith('tenant-1', {
      buildingId: 'b-1',
      lastMonths: 3,
      excludeCurrent: true,
    });
  });

  it('configures debt aging hook with asOf and building filters', async () => {
    useDebtAging('tenant-1', { asOf: '2026-04-19', buildingId: 'b-1' });
    const config = useQueryMock.mock.calls[0][0];

    expect(config.queryKey).toEqual([
      'dashboard-debt-aging',
      'tenant-1',
      '2026-04-19',
      'b-1',
    ]);

    getDebtAgingMock.mockResolvedValue({});
    await config.queryFn();
    expect(getDebtAgingMock).toHaveBeenCalledWith('tenant-1', {
      asOf: '2026-04-19',
      buildingId: 'b-1',
    });
  });

  it('configures debt by-period hook with asOf and building filters', async () => {
    useDebtByPeriod('tenant-1', { asOf: '2026-04-19', buildingId: 'b-1' });
    const config = useQueryMock.mock.calls[0][0];

    expect(config.queryKey).toEqual([
      'dashboard-debt-by-period',
      'tenant-1',
      '2026-04-19',
      'b-1',
    ]);

    getDebtByPeriodMock.mockResolvedValue({});
    await config.queryFn();
    expect(getDebtByPeriodMock).toHaveBeenCalledWith('tenant-1', {
      asOf: '2026-04-19',
      buildingId: 'b-1',
    });
  });

  it('configures building list hook with tenant key and disabled without tenant', async () => {
    useBuildingList(undefined);
    let config = useQueryMock.mock.calls[0][0];
    expect(config.queryKey).toEqual(['buildings-list', undefined]);
    expect(config.enabled).toBe(false);

    useQueryMock.mockReset();
    useQueryMock.mockReturnValue({ data: [] });

    useBuildingList('tenant-1');
    config = useQueryMock.mock.calls[0][0];
    fetchBuildingsMock.mockResolvedValue([]);
    await config.queryFn();
    expect(fetchBuildingsMock).toHaveBeenCalledWith('tenant-1');
  });
});
