/**
 * Subscription API Service
 * Handles tenant and super-admin subscription/billing API calls
 */

import { apiClient } from '@/shared/lib/http/client';

// Types (reuse from tenant-stats.api.ts for consistency)
export interface BillingPlan {
  name: string;
  planId: string;
  maxBuildings: number;
  maxUnits: number;
  maxUsers: number;
  maxOccupants: number;
  canExportReports: boolean;
  canBulkOperations: boolean;
  supportLevel: string;
  monthlyPrice: number;
}

export interface BillingUsage {
  buildings: number;
  units: number;
  users: number;
  residents: number;
}

export interface SubscriptionInfo {
  status: string;
  planId: string;
  currentPeriodEnd: string | null;
  trialEndDate: string | null;
}

export interface SubscriptionResponse {
  subscription: SubscriptionInfo;
  plan: BillingPlan;
  usage: BillingUsage;
}

export interface ChangePlanRequest {
  newPlanId: string;
}

// ============================================
// Tenant Endpoints (scoped to own tenant)
// ============================================

/**
 * GET /api/tenants/:tenantId/billing
 * Fetch current tenant's billing information
 */
export async function fetchSubscription(
  tenantId: string
): Promise<SubscriptionResponse> {
  return apiClient<SubscriptionResponse>({
    path: `/api/tenants/${tenantId}/billing`,
  });
}

// ============================================
// Super-Admin Endpoints (global access)
// ============================================

/**
 * GET /api/super-admin/tenants/:tenantId/billing
 * Fetch any tenant's billing information (super-admin only)
 */
export async function fetchTenantBillingAdmin(
  tenantId: string
): Promise<SubscriptionResponse> {
  return apiClient<SubscriptionResponse>({
    path: `/api/super-admin/tenants/${tenantId}/billing`,
  });
}

/**
 * PATCH /api/super-admin/tenants/:tenantId/subscription
 * Change a tenant's plan (super-admin only)
 */
export async function changePlanAdmin(
  tenantId: string,
  newPlanId: string
): Promise<void> {
  return apiClient<void, ChangePlanRequest>({
    path: `/api/super-admin/tenants/${tenantId}/subscription`,
    method: 'PATCH',
    body: { newPlanId },
  });
}
