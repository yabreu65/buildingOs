'use client';

import { useState, useEffect } from 'react';
import {
  analyticsApi,
  TenantSummaryItem,
} from '../services/analytics.api';

interface UseSuperAdminAiAnalyticsResult {
  tenants: TenantSummaryItem[];
  loading: boolean;
  error: string | null;
  month: string;
  setMonth: (month: string) => void;
  selectedTenantId: string | null;
  setSelectedTenantId: (id: string | null) => void;
  detailLoading: boolean;
  detailError: string | null;
  detail: any | null;
  refetch: () => Promise<void>;
}

/**
 * Custom hook for super-admin to view all tenants' AI analytics
 */
export function useSuperAdminAiAnalytics(): UseSuperAdminAiAnalyticsResult {
  const [month, setMonth] = useState<string>(getCurrentMonth());
  const [tenants, setTenants] = useState<TenantSummaryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Load all tenants summary
  const fetch = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await analyticsApi.getAllTenantsAnalytics(month);
      setTenants(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load analytics';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // Load detail when selectedTenantId changes
  useEffect(() => {
    if (!selectedTenantId) {
      setDetail(null);
      return;
    }

    const loadDetail = async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const data = await analyticsApi.getTenantDetailedAnalytics(
          selectedTenantId,
          month,
        );
        setDetail(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load details';
        setDetailError(message);
      } finally {
        setDetailLoading(false);
      }
    };

    loadDetail();
  }, [selectedTenantId, month]);

  // Initial fetch and refetch on month change
  useEffect(() => {
    fetch();
  }, [month]);

  return {
    tenants,
    loading,
    error,
    month,
    setMonth,
    selectedTenantId,
    setSelectedTenantId,
    detailLoading,
    detailError,
    detail,
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
