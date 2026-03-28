import { useState, useEffect, useCallback } from 'react';
import {
  getCommunicationsReport,
  type CommunicationsReport,
} from '../services/reports.api';

interface UseCommunicationsReportOptions {
  buildingId?: string;
  from?: string;
  to?: string;
}

/**
 * Hook for lazy-loading communications report
 * Only fetches when tenantId is provided (prevents spinner when tab inactive)
 */
export function useCommunicationsReport(
  tenantId: string | undefined,
  options: UseCommunicationsReportOptions = {}
) {
  const [data, setData] = useState<CommunicationsReport | null>(null);
  const [loading, setLoading] = useState(() => !!tenantId); // Only load if tenantId provided
  const [error, setError] = useState<string | null>(null);

  const { buildingId, from, to } = options;

  const loadReport = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await getCommunicationsReport(tenantId, { buildingId, from, to });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [tenantId, buildingId, from, to]);

  const refetch = useCallback(() => {
    loadReport();
  }, [loadReport]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  return { data, loading, error, refetch };
}
