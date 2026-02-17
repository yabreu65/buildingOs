'use client';

import { useCallback, useEffect, useState } from 'react';
import * as tenantStatsApi from '../services/tenant-stats.api';
import type { TenantStatsResponse } from '../services/tenant-stats.api';

export interface UseTenantStatsState {
  stats: TenantStatsResponse | null;
  loading: boolean;
  error: string | null;
}

export interface UseTenantStats extends UseTenantStatsState {
  refetch: () => Promise<void>;
}

/**
 * useTenantStats: Fetch tenant statistics (buildings, units, occupancy, residents)
 * Handles loading and error states with auto-refetch on tenantId changes
 */
export function useTenantStats(tenantId: string | undefined): UseTenantStats {
  const [state, setState] = useState<UseTenantStatsState>(() => ({
    stats: null,
    loading: !!tenantId, // only loading if tenantId is provided
    error: null,
  }));

  // Fetch stats
  const refetch = useCallback(async () => {
    if (!tenantId) return;

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const stats = await tenantStatsApi.fetchTenantStats(tenantId);
      setState({ stats, loading: false, error: null });
    } catch (err) {
      setState({
        stats: null,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch tenant stats',
      });
    }
  }, [tenantId]);

  // Auto-fetch on mount or tenantId change
  useEffect(() => {
    refetch();
  }, [refetch]);

  return {
    ...state,
    refetch,
  };
}
