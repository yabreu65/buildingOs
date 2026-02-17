'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/shared/lib/http/client';

export interface PlanFeatures {
  canExportReports: boolean;
  canBulkOperations: boolean;
  supportLevel: 'COMMUNITY' | 'EMAIL' | 'PRIORITY';
}

export interface SubscriptionData {
  subscription: {
    tenantId: string;
  } | null;
  features: PlanFeatures | null;
}

/**
 * useSubscription: Fetch current tenant's subscription features
 * Used for UI gating - never trust frontend for actual enforcement
 *
 * @returns { subscription, features, loading, error, refetch }
 */
export function useSubscription() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SubscriptionData>({
    subscription: null,
    features: null,
  });

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient<SubscriptionData>({
        path: '/api/auth/me/subscription',
      });
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch subscription');
      // Fail open - if we can't fetch features, assume all are false (safer)
      setData({
        subscription: null,
        features: null,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return {
    ...data,
    loading,
    error,
    refetch,
  };
}

/**
 * Helper to check if a feature is available
 * Usage: if (hasFeature(features, 'canExportReports')) { ... }
 */
export function hasFeature(
  features: PlanFeatures | null,
  featureKey: keyof PlanFeatures,
): boolean {
  if (!features) return false;
  const value = features[featureKey];
  return value === true || value === 'PRIORITY';
}
