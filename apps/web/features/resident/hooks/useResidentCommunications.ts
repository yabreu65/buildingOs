'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { getResidentCommunications, type InboxCommunication } from '../api/resident-context.api';

/**
 * Resident inbox communications scoped to the current user session.
 *
 * The query key includes tenant and user identity so switching accounts in the
 * same browser never reuses another resident's inbox data.
 */
export function useResidentCommunications(tenantId: string | null, limit = 3) {
  const session = useAuthSession();
  const userId = session?.user.id ?? null;

  return useQuery<InboxCommunication[]>({
    queryKey: ['residentCommunications', tenantId, userId, limit],
    queryFn: () => getResidentCommunications(limit),
    enabled: !!tenantId && !!userId,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });
}
