import { useQuery } from '@tanstack/react-query';
import { getFinanceSettings } from '../services/multicurrency.api';
import { financeKeys } from './finance-query-keys';

export function useFinanceSettings(tenantId: string) {
  return useQuery({
    queryKey: financeKeys.financeSettings(tenantId),
    queryFn: () => getFinanceSettings(tenantId),
    enabled: Boolean(tenantId),
    staleTime: 5 * 60 * 1000,
  });
}
