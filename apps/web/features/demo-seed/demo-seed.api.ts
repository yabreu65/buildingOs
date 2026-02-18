'use client';

import { getToken } from '@/features/auth/session.storage';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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
  const token = getToken();

  const response = await fetch(
    `${API_URL}/super-admin/tenants/${tenantId}/demo-seed/check`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to check demo data generation: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Generate demo data for TRIAL tenant
 */
export async function generateDemoData(tenantId: string): Promise<DemoSeedResult> {
  const token = getToken();

  const response = await fetch(
    `${API_URL}/super-admin/tenants/${tenantId}/demo-seed/generate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to generate demo data: ${response.statusText}`);
  }

  return response.json();
}
