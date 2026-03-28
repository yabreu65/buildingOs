'use client';

import { apiClient } from '@/shared/lib/http/client';

export interface OnboardingStep {
  id: string;
  label: string;
  description: string;
  status: 'DONE' | 'TODO';
  category: 'tenant' | 'building';
}

export interface TenantStepsResponse {
  tenantId: string;
  steps: OnboardingStep[];
  isDismissed: boolean;
  completionPercentage: number;
}

export interface BuildingStep {
  id: string;
  label: string;
  description: string;
  status: 'DONE' | 'TODO';
  category: 'building';
}

export interface BuildingStepsResponse {
  buildingId: string;
  tenantId: string;
  buildingName: string;
  steps: BuildingStep[];
  completionPercentage: number;
}

/**
 * Fetch tenant-level onboarding steps
 */
export async function getTenantSteps(tenantId: string): Promise<TenantStepsResponse> {
  return apiClient<TenantStepsResponse>({
    path: `/tenants/${tenantId}/onboarding/tenant`,
    method: 'GET',
    headers: {
      'X-Tenant-Id': tenantId,
    },
  });
}

/**
 * Fetch building-level onboarding steps
 */
export async function getBuildingSteps(
  tenantId: string,
  buildingId: string,
): Promise<BuildingStepsResponse> {
  return apiClient<BuildingStepsResponse>({
    path: `/tenants/${tenantId}/onboarding/buildings/${buildingId}`,
    method: 'GET',
    headers: {
      'X-Tenant-Id': tenantId,
    },
  });
}

/**
 * Dismiss onboarding checklist for the tenant
 */
export async function dismissOnboarding(tenantId: string): Promise<{ success: boolean }> {
  return apiClient<{ success: boolean }>({
    path: `/tenants/${tenantId}/onboarding/dismiss`,
    method: 'PATCH',
    headers: {
      'X-Tenant-Id': tenantId,
    },
  });
}

/**
 * Restore onboarding checklist visibility for the tenant
 */
export async function restoreOnboarding(tenantId: string): Promise<{ success: boolean }> {
  return apiClient<{ success: boolean }>({
    path: `/tenants/${tenantId}/onboarding/restore`,
    method: 'PATCH',
    headers: {
      'X-Tenant-Id': tenantId,
    },
  });
}
