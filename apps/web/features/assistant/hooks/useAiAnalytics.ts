'use client';

import { useState, useEffect } from 'react';
import { analyticsApi, TenantAnalyticsResponse } from '../services/analytics.api';

interface UseAiAnalyticsResult {
  analytics: TenantAnalyticsResponse | null;
  loading: boolean;
  error: string | null;
  month: string;
  setMonth: (month: string) => void;
  refetch: () => Promise<void>;
}

/**
 * Custom hook for loading tenant AI analytics
 * Automatically fetches on mount and when month changes
 */
export function useAiAnalytics(tenantId: string): UseAiAnalyticsResult {
  const [month, setMonth] = useState<string>(getCurrentMonth());
  const [analytics, setAnalytics] = useState<TenantAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await analyticsApi.getTenantAnalytics(tenantId, month);
      setAnalytics(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load analytics';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch();
  }, [tenantId, month]);

  return {
    analytics,
    loading,
    error,
    month,
    setMonth,
    refetch: fetch,
  };
}

/**
 * Get current month in YYYY-MM format
 */
function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
