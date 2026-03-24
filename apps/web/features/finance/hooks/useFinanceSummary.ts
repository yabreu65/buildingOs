import { useEffect, useState } from 'react';
import { getFinancialSummary, FinancialSummary } from '../services/finance.api';

export function useFinanceSummary(buildingId: string, period?: string) {
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [loading, setLoading] = useState(!!buildingId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!buildingId) {
      setLoading(false);
      return;
    }

    const fetch = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getFinancialSummary(buildingId, period);
        setSummary(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load summary');
        setSummary(null);
      } finally {
        setLoading(false);
      }
    };

    fetch();
  }, [buildingId, period]);

  const refetch = async () => {
    if (!buildingId) return;
    try {
      setLoading(true);
      const data = await getFinancialSummary(buildingId, period);
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh');
    } finally {
      setLoading(false);
    }
  };

  return { summary, loading, error, refetch };
}
