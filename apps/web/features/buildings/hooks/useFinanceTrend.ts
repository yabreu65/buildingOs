'use client';

import { useState, useEffect } from 'react';
import { financeApi } from '../services/finance.api';

export type MonthlyTrendDto = {
  period: string;
  totalCharges: number;
  totalPaid: number;
  totalOutstanding: number;
  collectionRate: number;
};

interface UseFinanceTrendResult {
  trend: MonthlyTrendDto[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useFinanceTrend(
  buildingId: string,
  months: number = 6,
): UseFinanceTrendResult {
  const [trend, setTrend] = useState<MonthlyTrendDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTrend = async () => {
    try {
      setLoading(true);
      const data = await financeApi.getFinanceTrend(buildingId, months);
      setTrend(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch trend'));
      setTrend([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (buildingId) {
      fetchTrend();
    }
  }, [buildingId, months]);

  return { trend, loading, error, refetch: fetchTrend };
}
