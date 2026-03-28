'use client';

import { useQuery } from '@tanstack/react-query';
import { getResidentContext, type ResidentContext } from '../api/resident-context.api';

/**
 * Hook to fetch the resident's active building/unit context.
 * Disabled when tenantId is absent.
 */
export function useResidentContext(tenantId: string | null) {
  return useQuery<ResidentContext>({
    queryKey: ['residentContext', tenantId],
    queryFn: () => getResidentContext(tenantId!),
    enabled: !!tenantId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });
}
