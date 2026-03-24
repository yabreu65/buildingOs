import { useEffect, useState } from 'react';
import { getTenantFinancialSummary, FinancialSummary } from '../services/finance.api';

export function useTenantFinanceSummary(period?: string) {
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getTenantFinancialSummary(period);
        setSummary(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tenant summary');
        setSummary(null);
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, [period]);

  const refetch = async () => {
    try {
      setLoading(true);
      const data = await getTenantFinancialSummary(period);
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh');
    } finally {
      setLoading(false);
    }
  };

  return { summary, loading, error, refetch };
}
