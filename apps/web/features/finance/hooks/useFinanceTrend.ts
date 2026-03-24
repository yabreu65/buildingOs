'use client';

import { useQuery } from '@tanstack/react-query';
import { financeApi } from '../services/finance.api';

export type MonthlyTrendDto = {
  period: string;
  totalCharges: number;
  totalPaid: number;
  totalOutstanding: number;
  collectionRate: number;
};

/**
 * Hook to fetch monthly financial trends for a building.
 * @param buildingId - Building ID to fetch trends for
 * @param months - Number of months to retrieve trend data for (default: 6)
 * @returns useQuery result with monthly trend data array
 */
export function useFinanceTrend(
  buildingId: string,
  months: number = 6,
) {
  return useQuery({
    queryKey: ['financeTrend', buildingId, months],
    queryFn: () => financeApi.getFinanceTrend(buildingId, months),
    staleTime: 10 * 60 * 1000, // 10 minutes (trend data changes less frequently)
    gcTime: 20 * 60 * 1000, // 20 minutes
    enabled: !!buildingId,
    initialData: [],
  });
}
