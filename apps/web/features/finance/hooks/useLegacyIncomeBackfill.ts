import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LegacyBackfillApplyItem, LegacyBackfillPreviewQuery } from '../contracts';
import {
  applyLegacyIncomeBackfill,
  previewLegacyIncomeBackfill,
} from '../services/legacy-backfill.api';
import { financeKeyFamilies, financeKeys } from './finance-query-keys';

export function useLegacyIncomeBackfillPreview(
  tenantId: string,
  query: LegacyBackfillPreviewQuery = {},
) {
  return useQuery({
    queryKey: financeKeys.legacyBackfillPreview(tenantId, query),
    queryFn: () => previewLegacyIncomeBackfill(tenantId, query),
    enabled: Boolean(tenantId),
    staleTime: 30 * 1000,
  });
}

export function useApplyLegacyIncomeBackfill(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (items: LegacyBackfillApplyItem[]) => applyLegacyIncomeBackfill(tenantId, items),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeKeyFamilies.incomes(tenantId) });
      void queryClient.invalidateQueries({ queryKey: financeKeyFamilies.funds(tenantId) });
      void queryClient.invalidateQueries({ queryKey: financeKeyFamilies.liquidations(tenantId) });
      void queryClient.invalidateQueries({ queryKey: financeKeyFamilies.legacyBackfill(tenantId) });
    },
  });
}
