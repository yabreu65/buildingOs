'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { getResidentContext, type ResidentContext } from '../api/resident-context.api';

/**
 * Hook to fetch the resident's active building/unit context.
 * Disabled when tenantId is absent.
 */
export function useResidentContext(tenantId: string | null) {
  const session = useAuthSession();
  const userId = session?.user.id ?? null;

  return useQuery<ResidentContext>({
    queryKey: ['residentContext', tenantId, userId],
    queryFn: () => getResidentContext(tenantId!),
    enabled: !!tenantId && !!userId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });
}
