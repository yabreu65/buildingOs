import { useState, useEffect, useCallback } from 'react';
import {
  getTicketsReport,
  type TicketsReport,
} from '../services/reports.api';

interface UseTicketsReportOptions {
  buildingId?: string;
  from?: string;
  to?: string;
}

/**
 * Hook for lazy-loading tickets report
 * Only fetches when tenantId is provided (prevents spinner when tab inactive)
 */
export function useTicketsReport(
  tenantId: string | undefined,
  options: UseTicketsReportOptions = {}
) {
  const [data, setData] = useState<TicketsReport | null>(null);
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
      const result = await getTicketsReport(tenantId, options);
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
