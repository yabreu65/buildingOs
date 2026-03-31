import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listPayments, approvePayment, rejectPayment, Payment } from '../services/finance.api';

/**
 * Hook to fetch payments for review for a building.
 * @param buildingId - Building ID to fetch payments for
 * @param status - Payment status filter (default: 'SUBMITTED')
 * @returns useQuery result with payments list
 */
export function usePaymentsReview(buildingId: string, status?: string) {
  return useQuery({
    queryKey: ['payments', buildingId, status],
    queryFn: () => listPayments(buildingId, status || 'SUBMITTED'),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!buildingId,
    placeholderData: (previousData) => previousData ?? [],
  });
}

/**
 * Hook to approve a payment
 * @param buildingId - Building ID
 * @returns Mutation result with approve function
 */
export function useApprovePayment(buildingId: string, status?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { paymentId: string; paidAt?: string }) =>
      approvePayment(buildingId, params.paymentId, params.paidAt),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments', buildingId, status] });
    },
  });
}

/**
 * Hook to reject a payment
 * @param buildingId - Building ID
 * @returns Mutation result with reject function
 */
export function useRejectPayment(buildingId: string, status?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { paymentId: string; reason?: string }) =>
      rejectPayment(buildingId, params.paymentId, params.reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments', buildingId, status] });
    },
  });
}
