/**
 * Super-Admin Tenants API Service
 * Fetches tenants from the backend API
 */

import { apiClient } from '@/shared/lib/http/client';

export interface TenantFromAPI {
  id: string;
  name: string;
  type: 'ADMINISTRADORA' | 'EDIFICIO_AUTOGESTION';
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  branding?: {
    logoUrl?: string;
    primaryColor?: string;
    companyName?: string;
  };
  // Subscription info (populated by backend if subscription exists)
  subscription: SubscriptionInfo | null;
}

export interface ListTenantsResponse {
  data: TenantFromAPI[];
  total: number;
}

export interface SubscriptionInfo {
  planId: string;
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';
}

export interface TenantDetailFromAPI extends TenantFromAPI {}

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

export async function createTenant(data: {
  name: string;
  type: TenantFromAPI['type'];
  planId: SubscriptionInfo['planId'];
}): Promise<TenantFromAPI> {
  return apiClient<TenantFromAPI, typeof data>({
    path: '/api/super-admin/tenants',
    method: 'POST',
    body: data,
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

/**
 * Delete tenant (demo only)
 */
export async function deleteTenant(tenantId: string): Promise<void> {
  return apiClient<void>({
    path: `/api/super-admin/tenants/${tenantId}`,
    method: 'DELETE',
  });
}
