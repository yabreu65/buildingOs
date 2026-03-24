import { InboxSummaryResponse } from './inbox.types';
import { apiClient } from '@/shared/lib/http/client';

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

  return apiClient<InboxSummaryResponse>({
    path: `/inbox/summary?${params.toString()}`,
    method: 'GET',
    headers: {
      'X-Tenant-Id': tenantId,
    },
  });
}
