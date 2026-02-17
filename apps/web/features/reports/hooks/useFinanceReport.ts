import { useState, useEffect, useCallback } from 'react';
import {
  getFinanceReport,
  type FinanceReport,
} from '../services/reports.api';

interface UseFinanceReportOptions {
  buildingId?: string;
  period?: string;
}

/**
 * Hook for lazy-loading finance report
 * Only fetches when tenantId is provided (prevents spinner when tab inactive)
 */
export function useFinanceReport(
  tenantId: string | undefined,
  options: UseFinanceReportOptions = {}
) {
  const [data, setData] = useState<FinanceReport | null>(null);
  const [loading, setLoading] = useState(() => !!tenantId); // Only load if tenantId provided
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await getFinanceReport(tenantId, options);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [tenantId, options]);

  const refetch = useCallback(() => {
    fetch();
  }, [fetch]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refetch };
}
