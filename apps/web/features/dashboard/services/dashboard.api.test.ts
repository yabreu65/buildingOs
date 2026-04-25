import { apiClient } from '@/shared/lib/http/client';
import {
  getDashboardSummary,
  getDebtSummary,
  getDebtAging,
  getDebtByPeriod,
  DashboardPeriod,
} from './dashboard.api';

jest.mock('@/shared/lib/http/client', () => ({
  apiClient: jest.fn(),
}));

describe('dashboard.api', () => {
  const apiClientMock = apiClient as jest.Mock;

  beforeEach(() => {
    apiClientMock.mockReset();
  });

  it('builds tenant-scoped dashboard summary path with filters', async () => {
    apiClientMock.mockResolvedValue({
      kpis: {},
      queues: {},
      buildingAlerts: [],
      quickActions: [],
      metadata: {},
    });

    await getDashboardSummary('tenant-1', {
      period: DashboardPeriod.PREVIOUS_MONTH,
      buildingId: 'building-1',
    });

    expect(apiClientMock).toHaveBeenCalledWith({
      path: '/tenants/tenant-1/dashboard/admin?period=PREVIOUS_MONTH&buildingId=building-1',
      method: 'GET',
    });
  });

  it('builds dashboard summary path with periodMonth', async () => {
    apiClientMock.mockResolvedValue({
      kpis: {},
      queues: {},
      buildingAlerts: [],
      quickActions: [],
      metadata: {},
    });

    await getDashboardSummary('tenant-1', {
      periodMonth: '2026-04',
      buildingId: 'building-1',
    });

    expect(apiClientMock).toHaveBeenCalledWith({
      path: '/tenants/tenant-1/dashboard/admin?periodMonth=2026-04&buildingId=building-1',
      method: 'GET',
    });
  });

  it('calls debt summary endpoint with defaults', async () => {
    apiClientMock.mockResolvedValue({
      periods: ['2026-01', '2026-02', '2026-03'],
      debtByPeriod: { '2026-01': 1000, '2026-02': 0, '2026-03': 500 },
      totalDebt: 1500,
    });

    await getDebtSummary('tenant-1');

    expect(apiClientMock).toHaveBeenCalledWith({
      path: '/tenants/tenant-1/reports/debt/summary?lastMonths=3&excludeCurrent=true',
      method: 'GET',
    });
  });

  it('calls debt summary endpoint with explicit params', async () => {
    apiClientMock.mockResolvedValue({
      periods: ['2026-01', '2026-02', '2026-03'],
      debtByPeriod: { '2026-01': 1000, '2026-02': 0, '2026-03': 500 },
      totalDebt: 1500,
    });

    await getDebtSummary('tenant-1', {
      buildingId: 'building-1',
      lastMonths: 6,
      excludeCurrent: false,
    });

    expect(apiClientMock).toHaveBeenCalledWith({
      path: '/tenants/tenant-1/reports/debt/summary?lastMonths=6&excludeCurrent=false&buildingId=building-1',
      method: 'GET',
    });
  });

  it('calls debt aging endpoint with asOf and building', async () => {
    apiClientMock.mockResolvedValue({
      asOf: '2026-04-19',
      totalOverdue: 1000,
      unitsMorosas: 1,
      buckets: { '0_30': 0, '31_60': 1000, '61_90': 0, '90_plus': 0 },
      worstCase: null,
      rowsByUnit: [],
    });

    await getDebtAging('tenant-1', {
      asOf: '2026-04-19',
      buildingId: 'building-1',
    });

    expect(apiClientMock).toHaveBeenCalledWith({
      path: '/tenants/tenant-1/reports/debt/aging?asOf=2026-04-19&buildingId=building-1',
      method: 'GET',
    });
  });

  it('calls debt by-period endpoint with asOf and building', async () => {
    apiClientMock.mockResolvedValue({
      asOf: '2026-04-19',
      rowsByUnit: [],
    });

    await getDebtByPeriod('tenant-1', {
      asOf: '2026-04-19',
      buildingId: 'building-1',
    });

    expect(apiClientMock).toHaveBeenCalledWith({
      path: '/tenants/tenant-1/reports/debt/by-period?asOf=2026-04-19&buildingId=building-1',
      method: 'GET',
    });
  });
});
