import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPaymentAllocations, createAllocations, PaymentAllocation } from '../services/finance.api';

/**
 * Hook to fetch payment allocations for a specific payment.
 * @param buildingId - Building ID
 * @param paymentId - Payment ID to fetch allocations for
 * @returns useQuery result with payment allocations data
 */
export function useAllocation(buildingId: string, paymentId?: string) {
  return useQuery({
    queryKey: ['allocations', buildingId, paymentId],
    queryFn: () => getPaymentAllocations(buildingId, paymentId!),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!buildingId && !!paymentId, // Only fetch if both buildingId and paymentId exist
    initialData: [],
  });
}

/**
 * Hook to create payment allocations
 * @param buildingId - Building ID
 * @returns Mutation result with createAllocations function
 */
export function useCreateAllocations(buildingId: string, paymentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (allocs: Array<{ chargeId: string; amount: number }>) =>
      createAllocations(buildingId, paymentId, allocs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allocations', buildingId, paymentId] });
    },
  });
}
