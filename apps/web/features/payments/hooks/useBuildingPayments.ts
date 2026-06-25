'use client';

import { useQuery } from '@tanstack/react-query';
import { listPayments, type Payment } from '@/features/finance/services/finance.api';

/**
 * Fetch payments for a building from the finance API.
 */
export function useBuildingPayments(buildingId?: string) {
  return useQuery<Payment[], Error>({
    queryKey: ['building-payments', buildingId],
    queryFn: () => listPayments(buildingId!, undefined, undefined, 500),
    enabled: Boolean(buildingId),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: (previousData) => previousData ?? [],
  });
}
