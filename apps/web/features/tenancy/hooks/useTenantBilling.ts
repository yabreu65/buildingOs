'use client';

import { useCallback, useEffect, useState } from 'react';
import * as tenantStatsApi from '../services/tenant-stats.api';
import type { TenantBillingResponse } from '../services/tenant-stats.api';

export interface UseTenantBillingState {
  billing: TenantBillingResponse | null;
  loading: boolean;
  error: string | null;
}

export interface UseTenantBilling extends UseTenantBillingState {
  refetch: () => Promise<void>;
}

/**
 * useTenantBilling: Fetch tenant billing information (subscription, plan, usage)
 * Handles loading and error states with auto-refetch on tenantId changes
 */
export function useTenantBilling(
  tenantId: string | undefined
): UseTenantBilling {
  const [state, setState] = useState<UseTenantBillingState>(() => ({
    billing: null,
    loading: !!tenantId, // only loading if tenantId is provided
    error: null,
  }));

  // Fetch billing
  const refetch = useCallback(async () => {
    if (!tenantId) return;

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const billing = await tenantStatsApi.fetchTenantBilling(tenantId);
      setState({ billing, loading: false, error: null });
    } catch (err) {
      setState({
        billing: null,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch tenant billing',
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
