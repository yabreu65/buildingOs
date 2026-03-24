import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getUnitLedger, submitPayment, UnitLedger, PaymentMethod } from '../services/finance.api';

/**
 * Hook to fetch financial ledger for a specific unit.
 * @param buildingId - Building ID (used for API calls)
 * @param unitId - Unit ID to fetch ledger for
 * @param periodFrom - Optional start period for ledger entries
 * @param periodTo - Optional end period for ledger entries
 * @returns useQuery result with unit ledger data (charges, payments, balance)
 */
export function useUnitLedger(buildingId: string, unitId: string, periodFrom?: string, periodTo?: string) {
  return useQuery({
    queryKey: ['unitLedger', unitId, periodFrom, periodTo],
    queryFn: () => getUnitLedger(unitId, periodFrom, periodTo),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!unitId, // Only fetch if unitId exists
    initialData: null,
  });
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
      queryClient.invalidateQueries({ queryKey: ['unitLedger', unitId, periodFrom, periodTo] });
    },
  });
}
