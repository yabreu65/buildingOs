import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listPeriods,
  getPeriod,
  createPeriod,
  updatePeriod,
  deletePeriod,
  generateCharges,
  publishPeriod,
  ExpensePeriod,
  ExpensePeriodDetail,
  ExpensePeriodStatus,
  GenerateResult,
} from '../services/expense-periods.api';

// Query Hook: List all periods
export function usePeriods(buildingId: string, year?: number, month?: number, status?: ExpensePeriodStatus) {
  return useQuery({
    queryKey: ['periods', buildingId, year, month, status],
    queryFn: () => listPeriods(buildingId, year, month, status),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    enabled: !!buildingId,
    initialData: [],
  });
}

// Query Hook: Get single period with charges
export function usePeriod(buildingId: string, periodId: string) {
  return useQuery({
    queryKey: ['period', buildingId, periodId],
    queryFn: () => getPeriod(buildingId, periodId),
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    enabled: !!buildingId && !!periodId,
  });
}

// Mutation Hook: Create period
export function useCreatePeriod(buildingId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      year: number;
      month: number;
      totalToAllocate: number;
      currency?: string;
      dueDate: string;
      concept: string;
    }) => createPeriod(buildingId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['periods', buildingId] });
    },
  });
}

// Mutation Hook: Update period
export function useUpdatePeriod(buildingId: string, periodId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      totalToAllocate?: number;
      currency?: string;
      dueDate?: string;
      concept?: string;
    }) => updatePeriod(buildingId, periodId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['period', buildingId, periodId] });
      queryClient.invalidateQueries({ queryKey: ['periods', buildingId] });
    },
  });
}

// Mutation Hook: Delete period
export function useDeletePeriod(buildingId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (periodId: string) => deletePeriod(buildingId, periodId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['periods', buildingId] });
    },
  });
}

// Mutation Hook: Generate charges
export function useGenerateCharges(buildingId: string, periodId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => generateCharges(buildingId, periodId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['period', buildingId, periodId] });
      queryClient.invalidateQueries({ queryKey: ['periods', buildingId] });
    },
  });
}

// Mutation Hook: Publish period
export function usePublishPeriod(buildingId: string, periodId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => publishPeriod(buildingId, periodId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['period', buildingId, periodId] });
      queryClient.invalidateQueries({ queryKey: ['periods', buildingId] });
    },
  });
}
