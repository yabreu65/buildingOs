import { useQuery } from '@tanstack/react-query';
import { getDashboardSummary, DashboardQuery } from '../services/dashboard.api';
import { fetchBuildings } from '@/features/buildings/services/buildings.api';

export function useDashboardSummary(query: DashboardQuery = {}) {
  return useQuery({
    queryKey: ['dashboard', query.period, query.buildingId],
    queryFn: () => getDashboardSummary(query),
    staleTime: 60 * 1000, // 1 minute
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
