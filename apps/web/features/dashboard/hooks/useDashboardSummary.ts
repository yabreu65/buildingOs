import { useQuery } from '@tanstack/react-query';
import {
  getDashboardSummary,
  DashboardQuery,
  DebtSummaryQuery,
  DebtAgingQuery,
  DebtByPeriodQuery,
  getDebtSummary,
  getDebtAging,
  getDebtByPeriod,
} from '../services/dashboard.api';
import { fetchBuildings } from '@/features/buildings/services/buildings.api';

export function useDashboardSummary(
  tenantId: string | undefined,
  query: DashboardQuery = {},
) {
  return useQuery({
    queryKey: ['dashboard', tenantId, query.period, query.periodMonth, query.buildingId],
    queryFn: () => {
      if (!tenantId) {
        throw new Error('tenantId is required to fetch dashboard summary');
      }
      return getDashboardSummary(tenantId, query);
    },
    staleTime: 60 * 1000, // 1 minute
    enabled: !!tenantId,
  });
}

export function useBuildingList(tenantId: string | undefined) {
  return useQuery({
    queryKey: ['buildings-list', tenantId],
    queryFn: () => {
      if (!tenantId) return Promise.resolve([]);
      return fetchBuildings(tenantId);
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!tenantId,
  });
}

export function useDebtSummary(
  tenantId: string | undefined,
  query: DebtSummaryQuery = {},
) {
  const lastMonths = query.lastMonths ?? 3;
  const excludeCurrent = query.excludeCurrent ?? true;

  return useQuery({
    queryKey: [
      'dashboard-debt-summary',
      tenantId,
      query.buildingId,
      lastMonths,
      excludeCurrent,
    ],
    queryFn: () => {
      if (!tenantId) {
        throw new Error('tenantId is required to fetch debt summary');
      }
      return getDebtSummary(tenantId, {
        ...query,
        lastMonths,
        excludeCurrent,
      });
    },
    staleTime: 60 * 1000,
    enabled: !!tenantId,
  });
}

export function useDebtAging(
  tenantId: string | undefined,
  query: DebtAgingQuery = {},
) {
  return useQuery({
    queryKey: ['dashboard-debt-aging', tenantId, query.asOf, query.buildingId],
    queryFn: () => {
      if (!tenantId) {
        throw new Error('tenantId is required to fetch debt aging');
      }
      return getDebtAging(tenantId, query);
    },
    staleTime: 60 * 1000,
    enabled: !!tenantId,
  });
}

export function useDebtByPeriod(
  tenantId: string | undefined,
  query: DebtByPeriodQuery = {},
) {
  return useQuery({
    queryKey: ['dashboard-debt-by-period', tenantId, query.asOf, query.buildingId],
    queryFn: () => {
      if (!tenantId) {
        throw new Error('tenantId is required to fetch debt by period');
      }
      return getDebtByPeriod(tenantId, query);
    },
    staleTime: 60 * 1000,
    enabled: !!tenantId,
  });
}
