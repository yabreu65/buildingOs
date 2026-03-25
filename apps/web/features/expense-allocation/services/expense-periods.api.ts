import { apiClient } from '@/shared/lib/http/client';

// Type Definitions
export type ExpensePeriodStatus = 'DRAFT' | 'GENERATED' | 'PUBLISHED' | 'CLOSED';

export interface ExpensePeriod {
  id: string;
  tenantId: string;
  buildingId: string;
  year: number;
  month: number;
  totalToAllocate: number;
  currency: string;
  dueDate: string;
  concept: string;
  status: ExpensePeriodStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Charge {
  id: string;
  unitId: string;
  unitCode: string;
  unitLabel: string | null;
  amount: number;
  status: string;
  coefficientSnapshot: number | null;
  categorySnapshotId: string | null;
}

export interface ExpensePeriodDetail extends ExpensePeriod {
  charges: Charge[];
}

export interface GenerateResult {
  chargesCount: number;
  totalAllocated: number;
}

export interface BlockedGenerationError {
  message: string;
  reason: string;
  unitsWithoutCategory?: Array<{
    id: string;
    code: string;
    label: string | null;
  }>;
}

// API Functions
export async function listPeriods(
  buildingId: string,
  year?: number,
  month?: number,
  status?: ExpensePeriodStatus
): Promise<ExpensePeriod[]> {
  const params = new URLSearchParams();
  if (year) params.append('year', year.toString());
  if (month) params.append('month', month.toString());
  if (status) params.append('status', status);

  const query = params.toString() ? `?${params.toString()}` : '';
  return apiClient<ExpensePeriod[]>({
    path: `/buildings/${buildingId}/expense-periods${query}`,
    method: 'GET',
  });
}

export async function getPeriod(buildingId: string, periodId: string): Promise<ExpensePeriodDetail> {
  return apiClient<ExpensePeriodDetail>({
    path: `/buildings/${buildingId}/expense-periods/${periodId}`,
    method: 'GET',
  });
}

export async function createPeriod(
  buildingId: string,
  data: {
    year: number;
    month: number;
    totalToAllocate: number;
    currency?: string;
    dueDate: string;
    concept: string;
  }
): Promise<ExpensePeriod> {
  return apiClient<ExpensePeriod, typeof data>({
    path: `/buildings/${buildingId}/expense-periods`,
    method: 'POST',
    body: data,
  });
}

export async function updatePeriod(
  buildingId: string,
  periodId: string,
  data: {
    totalToAllocate?: number;
    currency?: string;
    dueDate?: string;
    concept?: string;
  }
): Promise<ExpensePeriod> {
  return apiClient<ExpensePeriod, typeof data>({
    path: `/buildings/${buildingId}/expense-periods/${periodId}`,
    method: 'PATCH',
    body: data,
  });
}

export async function deletePeriod(buildingId: string, periodId: string): Promise<void> {
  return apiClient<void>({
    path: `/buildings/${buildingId}/expense-periods/${periodId}`,
    method: 'DELETE',
  });
}

export async function generateCharges(
  buildingId: string,
  periodId: string
): Promise<GenerateResult> {
  return apiClient<GenerateResult, {}>({
    path: `/buildings/${buildingId}/expense-periods/${periodId}/generate`,
    method: 'POST',
    body: {},
  });
}

export async function publishPeriod(buildingId: string, periodId: string): Promise<ExpensePeriod> {
  return apiClient<ExpensePeriod, {}>({
    path: `/buildings/${buildingId}/expense-periods/${periodId}/publish`,
    method: 'POST',
    body: {},
  });
}
