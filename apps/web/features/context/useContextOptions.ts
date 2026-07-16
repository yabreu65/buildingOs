'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { getContextOptions } from './context.api';
import type { ContextOptions } from './context.types';

/**
 * Query the accessible buildings and units for the current authenticated user.
 *
 * The cache key is user-scoped so switching residents in the same browser does
 * not reuse the previous user's context options.
 */
export function useContextOptions(tenantId: string | null) {
  const session = useAuthSession();
  const userId = session?.user.id ?? null;

  return useQuery<ContextOptions>({
    queryKey: ['contextOptions', tenantId, userId],
    queryFn: () => {
      if (!tenantId || !userId) {
        throw new Error('Tenant and user context are required');
      }

      return getContextOptions(tenantId);
    },
    enabled: !!tenantId && !!userId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });
}
