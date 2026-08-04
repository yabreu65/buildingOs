'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { useAuthorizedPortalContext } from '@/features/auth/useAuthorizedPortalContext';
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
  const activeTenantId = session?.activeTenantId ?? null;
  const portalContext = useAuthorizedPortalContext(tenantId);

  return useQuery<ContextOptions>({
    queryKey: ['contextOptions', tenantId, activeTenantId, userId, portalContext],
    queryFn: () => {
      if (!tenantId || !userId || activeTenantId !== tenantId) {
        throw new Error('Tenant and user context are required');
      }

      return getContextOptions(tenantId, portalContext);
    },
    enabled: !!tenantId && !!userId && activeTenantId === tenantId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });
}
