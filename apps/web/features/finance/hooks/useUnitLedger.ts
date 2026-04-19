import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getUnitLedger, submitPayment, UnitLedger, PaymentMethod } from '../services/finance.api';

/**
 * Hook to fetch financial ledger for a specific unit.
 * @param buildingId - Building ID (used for API calls)
 * @param unitId - Unit ID to fetch ledger for
 * @param periodFrom - Optional start period for ledger entries
 * @param periodTo - Optional end period for ledger entries
 * @returns useQuery result with unit ledger data (charges, payments, balance, error)
 */
export function useUnitLedger(tenantId: string, unitId: string, periodFrom?: string, periodTo?: string) {
  const queryResult = useQuery({
    queryKey: ['unitLedger', tenantId, unitId, periodFrom, periodTo],
    queryFn: () => getUnitLedger(tenantId, unitId, periodFrom, periodTo),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!tenantId && !!unitId, // Only fetch if unitId exists
    throwOnError: false,
  });

  // Return data, isLoading, error, and refetch for convenience
  return {
    data: queryResult.data,
    isLoading: queryResult.isLoading,
    error: queryResult.error,
    refetch: queryResult.refetch,
  };
}

/**
 * Hook to submit payment for a unit
 * @param buildingId - Building ID
 * @param unitId - Unit ID
 * @returns Mutation result with submitPayment function
 */
export function useSubmitUnitPayment(buildingId: string, unitId: string, periodFrom?: string, periodTo?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      amount: number;
      currency?: string;
      method: PaymentMethod;
      reference?: string;
      paidAt?: string;
      proofFileId?: string;
    }) => submitPayment(buildingId, { unitId, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unitLedger'] });
    },
  });
}
