import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listCharges, createCharge, cancelCharge, Charge, ChargeType, ChargeStatus } from '../services/finance.api';

/**
 * Hook to fetch charges for a building
 * @param buildingId - Building ID to fetch charges for
 * @param period - Optional period filter
 * @param unitId - Optional unit ID filter
 * @returns Query result with charges data
 */
export function useCharges(buildingId: string, period?: string, unitId?: string) {
  return useQuery({
    queryKey: ['charges', buildingId, period, unitId],
    queryFn: () => listCharges(buildingId, period, unitId),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!buildingId, // Only fetch if buildingId exists
    initialData: [],
  });
}

/**
 * Hook to create a new charge
 * @param buildingId - Building ID
 * @returns Mutation result with create function
 */
export function useCreateCharge(buildingId: string, period?: string, unitId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      unitId: string;
      type: ChargeType;
      concept: string;
      amount: number;
      currency?: string;
      period?: string;
      dueDate: string;
    }) => createCharge(buildingId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['charges', buildingId, period, unitId] });
    },
  });
}

/**
 * Hook to cancel a charge
 * @param buildingId - Building ID
 * @returns Mutation result with cancel function
 */
export function useCancelCharge(buildingId: string, period?: string, unitId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (chargeId: string) => cancelCharge(buildingId, chargeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['charges', buildingId, period, unitId] });
    },
  });
}
