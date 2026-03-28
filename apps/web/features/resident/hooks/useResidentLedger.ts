'use client';

import { useQuery } from '@tanstack/react-query';
import { getResidentLedger, type UnitLedger } from '../api/resident-context.api';

/**
 * Hook to fetch the financial ledger for a resident's active unit.
 * Disabled when unitId is absent.
 */
export function useResidentLedger(unitId: string | null | undefined) {
  return useQuery<UnitLedger>({
    queryKey: ['residentLedger', unitId],
    queryFn: () => getResidentLedger(unitId!),
    enabled: !!unitId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });
}
