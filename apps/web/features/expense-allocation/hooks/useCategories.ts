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
export function useCategories(buildingId: string) {
  return useQuery({
    queryKey: ['categories', buildingId],
    queryFn: () => listCategories(buildingId),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    enabled: !!buildingId,
    initialData: [],
  });
}

// Mutation Hook: Create category
export function useCreateCategory(buildingId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      minM2: number;
      maxM2: number | null;
      coefficient: number;
    }) => createCategory(buildingId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories', buildingId] });
    },
  });
}

// Mutation Hook: Update category
export function useUpdateCategory(buildingId: string) {
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
    }) => updateCategory(buildingId, categoryId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories', buildingId] });
    },
  });
}

// Mutation Hook: Delete category
export function useDeleteCategory(buildingId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (categoryId: string) => deleteCategory(buildingId, categoryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories', buildingId] });
    },
  });
}

// Query Hook: Auto-assign preview (read-only)
export function useAutoAssignPreview(buildingId: string, force: boolean = false) {
  return useQuery({
    queryKey: ['auto-assign-preview', buildingId, force],
    queryFn: () => autoAssignPreview(buildingId, force),
    staleTime: 1 * 60 * 1000, // 1 minute
    gcTime: 5 * 60 * 1000,
    enabled: !!buildingId,
  });
}

// Mutation Hook: Auto-assign and save
export function useAutoAssign(buildingId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (force: boolean = false) => autoAssignUnits(buildingId, force),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories', buildingId] });
      queryClient.invalidateQueries({ queryKey: ['auto-assign-preview', buildingId] });
    },
  });
}
