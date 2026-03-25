import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  autoAssignPreview,
  autoAssignUnits,
  UnitCategory,
  AutoAssignResult,
} from '../services/expense-categories.api';

// Query Hook: List all categories
export function useCategories(tenantId: string, buildingId: string) {
  return useQuery({
    queryKey: ['categories', tenantId, buildingId],
    queryFn: () => listCategories(tenantId, buildingId),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    enabled: !!tenantId && !!buildingId,
    placeholderData: [],
  });
}

// Mutation Hook: Create category
export function useCreateCategory(tenantId: string, buildingId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      minM2: number;
      maxM2: number | null;
      coefficient: number;
    }) => createCategory(tenantId, buildingId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories', tenantId, buildingId] });
    },
  });
}

// Mutation Hook: Update category
export function useUpdateCategory(tenantId: string, buildingId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      categoryId,
      data,
    }: {
      categoryId: string;
      data: {
        name?: string;
        minM2?: number;
        maxM2?: number | null;
        coefficient?: number;
        active?: boolean;
      };
    }) => updateCategory(tenantId, buildingId, categoryId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories', tenantId, buildingId] });
    },
  });
}

// Mutation Hook: Delete category
export function useDeleteCategory(tenantId: string, buildingId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (categoryId: string) => deleteCategory(tenantId, buildingId, categoryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories', tenantId, buildingId] });
    },
  });
}

// Query Hook: Auto-assign preview (read-only)
export function useAutoAssignPreview(tenantId: string, buildingId: string, force: boolean = false) {
  return useQuery({
    queryKey: ['auto-assign-preview', tenantId, buildingId, force],
    queryFn: () => autoAssignPreview(tenantId, buildingId, force),
    staleTime: 1 * 60 * 1000, // 1 minute
    gcTime: 5 * 60 * 1000,
    enabled: !!tenantId && !!buildingId,
  });
}

// Mutation Hook: Auto-assign and save
export function useAutoAssign(tenantId: string, buildingId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (force: boolean = false) => autoAssignUnits(tenantId, buildingId, force),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories', tenantId, buildingId] });
      queryClient.invalidateQueries({ queryKey: ['auto-assign-preview', tenantId, buildingId] });
    },
  });
}
