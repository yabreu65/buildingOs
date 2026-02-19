'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/shared/lib/http/client';

export interface EffectiveLimits {
  budgetCents: number;
  callsLimit: number;
  allowBigModel: boolean;
}

export interface AiUsageData {
  month: string;
  budgetCents: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostCents: number;
  warnedAt?: Date;
  blockedAt?: Date;
  callsWarnedAt?: Date;
  percentUsed: number;
  callsPercent: number;
}

export interface AiLimits {
  limits: EffectiveLimits;
  usage: AiUsageData;
  loading: boolean;
  error?: string;
}

/**
 * Phase 13: Hook to fetch AI limits and usage for a tenant
 * Returns effective limits (from plan + overrides) and current usage
 */
export function useAiLimits(tenantId: string): AiLimits {
  const [limits, setLimits] = useState<EffectiveLimits | null>(null);
  const [usage, setUsage] = useState<AiUsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(undefined);

        // Fetch usage with limits
        const response = await apiClient<any>({
          path: `/tenants/${tenantId}/assistant/usage-with-limits`,
          method: 'GET',
        });

        if (response) {
          setLimits(response.limits);
          setUsage(response);
        }
      } catch (err) {
        console.error('Failed to fetch AI limits:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch AI limits');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [tenantId]);

  return {
    limits: limits || { budgetCents: 0, callsLimit: 0, allowBigModel: false },
    usage: usage || {
      month: new Date().toISOString().slice(0, 7),
      budgetCents: 0,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostCents: 0,
      percentUsed: 0,
      callsPercent: 0,
    },
    loading,
    error,
  };
}
