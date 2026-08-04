'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { getResidentLedger, type UnitLedger } from '../api/resident-context.api';

/**
 * Hook to fetch the financial ledger for a resident's active unit.
 * Disabled when unitId is absent.
 */
export function useResidentLedger(
  tenantId: string | null | undefined,
  unitId: string | null | undefined,
) {
  const session = useAuthSession();
  const userId = session?.user.id ?? null;
  const activeTenantId = session?.activeTenantId ?? null;

  return useQuery<UnitLedger>({
    queryKey: ['residentLedger', tenantId, activeTenantId, userId, unitId],
    queryFn: () => {
      if (!tenantId || !unitId) {
        throw new Error('Tenant and unit context are required');
      }

      return getResidentLedger(tenantId, unitId);
    },
    enabled: !!tenantId && !!unitId && !!userId && activeTenantId === tenantId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });
}
