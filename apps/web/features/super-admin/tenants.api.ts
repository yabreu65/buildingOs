/**
 * Super-Admin Tenants API Service
 * Fetches tenants from the backend API
 */

import { apiClient } from '@/shared/lib/http/client';

export interface TenantFromAPI {
  id: string;
  name: string;
  type: 'ADMINISTRADORA' | 'EDIFICIO_AUTOGESTION';
  createdAt: string;
  updatedAt: string;
  branding?: {
    logoUrl?: string;
    primaryColor?: string;
    companyName?: string;
  };
  // Subscription info (populated by backend if subscription exists)
  subscription?: SubscriptionInfo[];
  // Derived status from subscription
  status?: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELED';
}

export interface ListTenantsResponse {
  data: TenantFromAPI[];
  total: number;
}

export interface SubscriptionInfo {
  id: string;
  tenantId: string;
  planId: string;
  status: 'TRIAL' | 'ACTIVE' | 'CANCELED';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndDate?: string;
  plan?: {
    planId: string;
    name: string;
  };
}

export interface TenantDetailFromAPI extends TenantFromAPI {
  subscription?: SubscriptionInfo[];
}

/**
 * List all tenants
 */
export async function listTenants(options?: {
  skip?: number;
  take?: number;
}): Promise<ListTenantsResponse> {
  const params = new URLSearchParams();
  if (options?.skip) params.append('skip', String(options.skip));
  if (options?.take) params.append('take', String(options.take));

  const qs = params.toString();
  return apiClient<ListTenantsResponse>({
    path: `/api/super-admin/tenants${qs ? '?' + qs : ''}`,
    method: 'GET',
  });
}

/**
 * Get single tenant by ID
 */
export async function getTenant(tenantId: string): Promise<TenantDetailFromAPI> {
  return apiClient<TenantDetailFromAPI>({
    path: `/api/super-admin/tenants/${tenantId}`,
    method: 'GET',
  });
}

/**
 * Update tenant
 */
export async function updateTenant(
  tenantId: string,
  data: Partial<{ name: string; type: string }>
): Promise<TenantFromAPI> {
  return apiClient<TenantFromAPI, typeof data>({
    path: `/api/super-admin/tenants/${tenantId}`,
    method: 'PATCH',
    body: data,
  });
}

/**
 * Change tenant subscription plan
 */
export async function changeTenantPlan(
  tenantId: string,
  newPlanId: string
): Promise<{ success: boolean; subscription: SubscriptionInfo }> {
  return apiClient({
    path: `/api/super-admin/tenants/${tenantId}/subscription`,
    method: 'PATCH',
    body: { newPlanId },
  });
}
