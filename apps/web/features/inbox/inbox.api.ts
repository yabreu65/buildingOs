import { InboxSummaryResponse } from './inbox.types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';

/**
 * Get unified inbox summary for tenant
 */
export async function getInboxSummary(
  tenantId: string,
  buildingId?: string | null,
  limit: number = 20,
): Promise<InboxSummaryResponse> {
  const params = new URLSearchParams();
  if (buildingId) {
    params.append('buildingId', buildingId);
  }
  params.append('limit', String(limit));

  const response = await fetch(`${API_URL}/inbox/summary?${params.toString()}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': tenantId,
      Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get inbox summary: ${response.statusText}`);
  }

  return response.json();
}
