import { useQuery } from '@tanstack/react-query';
import { getFinanceSettings } from '../services/multicurrency.api';

export function useFinanceSettings(tenantId: string) {
  return useQuery({
    queryKey: ['finance-settings', tenantId],
    queryFn: () => getFinanceSettings(tenantId),
    enabled: Boolean(tenantId),
    staleTime: 5 * 60 * 1000,
  });
}
