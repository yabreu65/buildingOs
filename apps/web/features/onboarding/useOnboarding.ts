'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getTenantSteps,
  dismissOnboarding,
  restoreOnboarding,
  type TenantStepsResponse,
  type OnboardingStep,
} from './onboarding.api';

interface UseOnboardingReturn {
  steps: OnboardingStep[];
  loading: boolean;
  error: string | null;
  isDismissed: boolean;
  completionPercentage: number;
  dismiss: () => Promise<void>;
  restore: () => Promise<void>;
  refetch: () => Promise<void>;
}

/**
 * Custom hook for tenant-level onboarding state management
 * Fetches steps, handles dismiss/restore, and tracks completion
 */
export function useOnboarding(tenantId: string): UseOnboardingReturn {
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [loading, setLoading] = useState(tenantId ? true : false);
  const [error, setError] = useState<string | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [completionPercentage, setCompletionPercentage] = useState(0);

  // Fetch steps
  const fetchSteps = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const data: TenantStepsResponse = await getTenantSteps(tenantId);

      setSteps(data.steps);
      setIsDismissed(data.isDismissed);
      setCompletionPercentage(data.completionPercentage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch onboarding steps');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  // Fetch on mount and when tenantId changes
  useEffect(() => {
    fetchSteps();
  }, [fetchSteps]);

  // Dismiss onboarding
  const dismiss = useCallback(async () => {
    if (!tenantId) return;

    try {
      await dismissOnboarding(tenantId);
      setIsDismissed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dismiss onboarding');
    }
  }, [tenantId]);

  // Restore onboarding
  const restore = useCallback(async () => {
    if (!tenantId) return;

    try {
      await restoreOnboarding(tenantId);
      setIsDismissed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore onboarding');
    }
  }, [tenantId]);

  // Refetch
  const refetch = useCallback(async () => {
    await fetchSteps();
  }, [fetchSteps]);

  return {
    steps,
    loading,
    error,
    isDismissed,
    completionPercentage,
    dismiss,
    restore,
    refetch,
  };
}
