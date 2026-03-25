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
export function usePeriods(tenantId: string, buildingId: string, year?: number, month?: number, status?: ExpensePeriodStatus) {
  return useQuery({
    queryKey: ['periods', tenantId, buildingId, year, month, status],
    queryFn: () => listPeriods(tenantId, buildingId, year, month, status),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    enabled: !!tenantId && !!buildingId,
    placeholderData: [],
  });
}

// Query Hook: Get single period with charges
export function usePeriod(tenantId: string, buildingId: string, periodId: string) {
  return useQuery({
    queryKey: ['period', tenantId, buildingId, periodId],
    queryFn: () => getPeriod(tenantId, buildingId, periodId),
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    enabled: !!buildingId && !!periodId,
  });
}

// Mutation Hook: Create period
export function useCreatePeriod(tenantId: string, buildingId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      year: number;
      month: number;
      totalToAllocate: number;
      currency?: string;
      dueDate: string;
      concept: string;
    }) => createPeriod(tenantId, buildingId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['periods', tenantId, buildingId] });
    },
  });
}

// Mutation Hook: Update period
export function useUpdatePeriod(tenantId: string, buildingId: string, periodId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      totalToAllocate?: number;
      currency?: string;
      dueDate?: string;
      concept?: string;
    }) => updatePeriod(tenantId, buildingId, periodId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['period', tenantId, buildingId, periodId] });
      queryClient.invalidateQueries({ queryKey: ['periods', tenantId, buildingId] });
    },
  });
}

// Mutation Hook: Delete period
export function useDeletePeriod(tenantId: string, buildingId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (periodId: string) => deletePeriod(tenantId, buildingId, periodId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['periods', tenantId, buildingId] });
    },
  });
}

// Mutation Hook: Generate charges
export function useGenerateCharges(tenantId: string, buildingId: string, periodId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => generateCharges(tenantId, buildingId, periodId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['period', tenantId, buildingId, periodId] });
      queryClient.invalidateQueries({ queryKey: ['periods', tenantId, buildingId] });
    },
  });
}

// Mutation Hook: Publish period
export function usePublishPeriod(tenantId: string, buildingId: string, periodId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => publishPeriod(tenantId, buildingId, periodId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['period', tenantId, buildingId, periodId] });
      queryClient.invalidateQueries({ queryKey: ['periods', tenantId, buildingId] });
    },
  });
}
