import { useQuery } from '@tanstack/react-query';
import { getTenantFinancialSummary, FinancialSummary } from '../services/finance.api';

/**
 * Hook to fetch aggregated financial summary across all tenant buildings.
 * @param period - Optional period filter for the summary
 * @returns useQuery result with aggregated tenant-level financial data
 */
export function useTenantFinanceSummary(period?: string) {
  return useQuery({
    queryKey: ['tenantFinanceSummary', period || 'all'],
    queryFn: async () => {
      console.log('[DEBUG] Fetching tenant financial summary, period:', period);
      const result = await getTenantFinancialSummary(period);
      console.log('[DEBUG] Tenant financial summary result:', result);
      return result;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    initialData: null,
  });
}
