'use client';

import { apiClient } from '@/shared/lib/http/client';

export interface DemoSeedCheckResponse {
  canGenerate: boolean;
  reason?: string;
}

export interface DemoSeedResult {
  success: boolean;
  summary: {
    buildingsCreated: number;
    unitsCreated: number;
    usersCreated: number;
    occupantsCreated: number;
    ticketsCreated: number;
    supportTicketsCreated: number;
    paymentsCreated: number;
    documentsCreated: number;
  };
}

/**
 * Check if demo data can be generated for tenant
 */
export async function checkCanGenerateDemoData(
  tenantId: string,
): Promise<DemoSeedCheckResponse> {
  return apiClient<DemoSeedCheckResponse>({
    path: `/super-admin/tenants/${tenantId}/demo-seed/check`,
    method: 'GET',
  });
}

/**
 * Generate demo data for TRIAL tenant
 */
export async function generateDemoData(tenantId: string): Promise<DemoSeedResult> {
  return apiClient<DemoSeedResult>({
    path: `/super-admin/tenants/${tenantId}/demo-seed/generate`,
    method: 'POST',
  });
}
