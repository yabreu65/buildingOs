import { useMutation, useQuery } from '@tanstack/react-query';
import {
  liquidationApi,
  LiquidationDraft,
  LiquidationDetail,
} from '../services/liquidation.api';

/**
 * Hook to create a liquidation draft
 */
export function useCreateLiquidation(tenantId: string) {
  return useMutation({
    mutationFn: (payload: {
      buildingId: string;
      period: string;
      baseCurrency: string;
    }) => liquidationApi.createDraft(tenantId, payload),
  });
}

/**
 * Hook to get liquidation detail with expenses and charges
 */
export function useLiquidationDetail(
  tenantId: string,
  liquidationId: string | undefined,
) {
  return useQuery({
    queryKey: ['liquidation', tenantId, liquidationId],
    queryFn: () => {
      if (!liquidationId) throw new Error('Missing liquidationId');
      return liquidationApi.getDetail(tenantId, liquidationId);
    },
    enabled: !!liquidationId,
  });
}

/**
 * Hook to review a liquidation
 */
export function useReviewLiquidation(tenantId: string) {
  return useMutation({
    mutationFn: (liquidationId: string) =>
      liquidationApi.review(tenantId, liquidationId),
  });
}

/**
 * Hook to publish a liquidation (creates charges)
 */
export function usePublishLiquidation(tenantId: string) {
  return useMutation({
    mutationFn: ({
      liquidationId,
      dueDate,
    }: {
      liquidationId: string;
      dueDate: string;
    }) => liquidationApi.publish(tenantId, liquidationId, dueDate),
  });
}

/**
 * Hook to cancel a liquidation
 */
export function useCancelLiquidation(tenantId: string) {
  return useMutation({
    mutationFn: (liquidationId: string) =>
      liquidationApi.cancel(tenantId, liquidationId),
  });
}
