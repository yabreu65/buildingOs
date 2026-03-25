import { apiClient } from '@/shared/lib/http/client';

// Type Definitions
export interface UnitCategory {
  id: string;
  tenantId: string;
  buildingId: string;
  name: string;
  minM2: number;
  maxM2: number | null;
  coefficient: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AutoAssignResult {
  assigned: number;
  unassigned: Array<{
    id: string;
    code: string;
    label: string | null;
    m2: number | null;
  }>;
  noM2: Array<{
    id: string;
    code: string;
    label: string | null;
  }>;
  alreadyAssigned: number;
}

// API Functions
export async function listCategories(buildingId: string): Promise<UnitCategory[]> {
  return apiClient<UnitCategory[]>({
    path: `/buildings/${buildingId}/expense-categories`,
    method: 'GET',
  });
}

export async function getCategory(buildingId: string, categoryId: string): Promise<UnitCategory> {
  return apiClient<UnitCategory>({
    path: `/buildings/${buildingId}/expense-categories/${categoryId}`,
    method: 'GET',
  });
}

export async function createCategory(
  buildingId: string,
  data: {
    name: string;
    minM2: number;
    maxM2: number | null;
    coefficient: number;
  }
): Promise<UnitCategory> {
  return apiClient<UnitCategory, typeof data>({
    path: `/buildings/${buildingId}/expense-categories`,
    method: 'POST',
    body: data,
  });
}

export async function updateCategory(
  buildingId: string,
  categoryId: string,
  data: {
    name?: string;
    minM2?: number;
    maxM2?: number | null;
    coefficient?: number;
    active?: boolean;
  }
): Promise<UnitCategory> {
  return apiClient<UnitCategory, typeof data>({
    path: `/buildings/${buildingId}/expense-categories/${categoryId}`,
    method: 'PATCH',
    body: data,
  });
}

export async function deleteCategory(buildingId: string, categoryId: string): Promise<void> {
  return apiClient<void>({
    path: `/buildings/${buildingId}/expense-categories/${categoryId}`,
    method: 'DELETE',
  });
}

export async function autoAssignPreview(
  buildingId: string,
  force: boolean = false
): Promise<AutoAssignResult> {
  return apiClient<AutoAssignResult, { force: boolean }>({
    path: `/buildings/${buildingId}/expense-categories/auto-assign/preview`,
    method: 'POST',
    body: { force },
  });
}

export async function autoAssignUnits(
  buildingId: string,
  force: boolean = false
): Promise<AutoAssignResult> {
  return apiClient<AutoAssignResult, { force: boolean }>({
    path: `/buildings/${buildingId}/expense-categories/auto-assign`,
    method: 'POST',
    body: { force },
  });
}
