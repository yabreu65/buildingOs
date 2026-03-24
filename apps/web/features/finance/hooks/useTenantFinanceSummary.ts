import { useQuery } from '@tanstack/react-query';
import { getTenantFinancialSummary, FinancialSummary } from '../services/finance.api';

/**
 * Hook to fetch aggregated financial summary across all tenant buildings.
 * @param period - Optional period filter for the summary
 * @returns useQuery result with aggregated tenant-level financial data
 */
export function useTenantFinanceSummary(period?: string) {
  return useQuery({
    queryKey: ['tenantFinanceSummary', period],
    queryFn: () => getTenantFinancialSummary(period),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    initialData: null,
  });
}
