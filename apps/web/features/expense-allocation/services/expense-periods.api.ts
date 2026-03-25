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
  tenantId: string,
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
    path: `/tenants/${tenantId}/buildings/${buildingId}/expense-periods${query}`,
    method: 'GET',
  });
}

export async function getPeriod(tenantId: string, buildingId: string, periodId: string): Promise<ExpensePeriodDetail> {
  return apiClient<ExpensePeriodDetail>({
    path: `/tenants/${tenantId}/buildings/${buildingId}/expense-periods/${periodId}`,
    method: 'GET',
  });
}

export async function createPeriod(
  tenantId: string,
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
    path: `/tenants/${tenantId}/buildings/${buildingId}/expense-periods`,
    method: 'POST',
    body: data,
  });
}

export async function updatePeriod(
  tenantId: string,
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
    path: `/tenants/${tenantId}/buildings/${buildingId}/expense-periods/${periodId}`,
    method: 'PATCH',
    body: data,
  });
}

export async function deletePeriod(tenantId: string, buildingId: string, periodId: string): Promise<void> {
  return apiClient<void>({
    path: `/tenants/${tenantId}/buildings/${buildingId}/expense-periods/${periodId}`,
    method: 'DELETE',
  });
}

export async function generateCharges(
  tenantId: string,
  buildingId: string,
  periodId: string
): Promise<GenerateResult> {
  return apiClient<GenerateResult, {}>({
    path: `/tenants/${tenantId}/buildings/${buildingId}/expense-periods/${periodId}/generate`,
    method: 'POST',
    body: {},
  });
}

export async function publishPeriod(tenantId: string, buildingId: string, periodId: string): Promise<ExpensePeriod> {
  return apiClient<ExpensePeriod, {}>({
    path: `/tenants/${tenantId}/buildings/${buildingId}/expense-periods/${periodId}/publish`,
    method: 'POST',
    body: {},
  });
}
