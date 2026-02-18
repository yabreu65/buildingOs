'use client';

import { getToken } from '@/features/auth/session.storage';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function getHeaders(tenantId?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (tenantId) {
    headers['X-Tenant-Id'] = tenantId;
  }

  return headers;
}

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
  const response = await fetch(`${API_BASE}/onboarding/tenant`, {
    method: 'GET',
    headers: getHeaders(tenantId),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch tenant steps: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch building-level onboarding steps
 */
export async function getBuildingSteps(
  tenantId: string,
  buildingId: string,
): Promise<BuildingStepsResponse> {
  const response = await fetch(`${API_BASE}/onboarding/buildings/${buildingId}`, {
    method: 'GET',
    headers: getHeaders(tenantId),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch building steps: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Dismiss onboarding checklist for the tenant
 */
export async function dismissOnboarding(tenantId: string): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE}/onboarding/dismiss`, {
    method: 'PATCH',
    headers: getHeaders(tenantId),
  });

  if (!response.ok) {
    throw new Error(`Failed to dismiss onboarding: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Restore onboarding checklist visibility for the tenant
 */
export async function restoreOnboarding(tenantId: string): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE}/onboarding/restore`, {
    method: 'PATCH',
    headers: getHeaders(tenantId),
  });

  if (!response.ok) {
    throw new Error(`Failed to restore onboarding: ${response.statusText}`);
  }

  return response.json();
}
