import { useQuery } from '@tanstack/react-query';
import { getFinancialSummary, FinancialSummary } from '../services/finance.api';

/**
 * Hook to fetch financial summary for a building.
 * @param buildingId - Building ID to fetch summary for
 * @param period - Optional period filter for the summary
 * @returns useQuery result with financial summary data (charges, payments, outstanding)
 */
export function useFinanceSummary(buildingId: string, period?: string) {
  return useQuery({
    queryKey: ['financeSummary', buildingId, period],
    queryFn: () => getFinancialSummary(buildingId, period),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!buildingId,
  });
}
