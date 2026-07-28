import { apiClient } from '@/shared/lib/http/client';

export interface ResidentProfile {
  id: string;
  tenantId: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateResidentProfileInput {
  name?: string;
  phone?: string | null;
}

function getTenantHeaders(tenantId: string): Record<string, string> {
  if (!tenantId || tenantId.trim() === '') {
    throw new Error('tenantId is required');
  }

  return {
    'X-Tenant-Id': tenantId,
  };
}

export async function getResidentProfile(tenantId: string): Promise<ResidentProfile> {
  return apiClient<ResidentProfile>({
    path: '/me/profile',
    method: 'GET',
    headers: getTenantHeaders(tenantId),
  });
}

export async function updateResidentProfile(
  tenantId: string,
  input: UpdateResidentProfileInput,
): Promise<ResidentProfile> {
  return apiClient<ResidentProfile, UpdateResidentProfileInput>({
    path: '/me/profile',
    method: 'PATCH',
    body: input,
    headers: getTenantHeaders(tenantId),
  });
}
