'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { InboxSummaryResponse } from './inbox.types';
import { getInboxSummary } from './inbox.api';

interface UseInboxSummaryState {
  summary: InboxSummaryResponse | null;
  loading: boolean;
  error: string | null;
}

/**
 * Custom hook for unified inbox summary
 *
 * Usage:
 * const { summary, loading, error, refetch } = useInboxSummary(tenantId, buildingId);
 */
export function useInboxSummary(
  tenantId: string | null,
  buildingId?: string | null,
  limit: number = 20,
) {
  const session = useAuthSession();
  const userId = session?.user.id ?? null;
  const [state, setState] = useState<UseInboxSummaryState>({
    summary: null,
    loading: false,
    error: null,
  });

  // Load summary on mount or when dependencies change
  useEffect(() => {
    if (!tenantId || !userId) {
      setState({ summary: null, loading: false, error: null });
      return;
    }

    let isActive = true;
    const loadSummary = async () => {
      setState({ summary: null, loading: true, error: null });
      try {
        const summary = await getInboxSummary(tenantId, buildingId, limit);
        if (!isActive) return;
        setState({ summary, loading: false, error: null });
      } catch (error) {
        if (!isActive) return;
        const message = error instanceof Error ? error.message : 'Unknown error';
        setState({ summary: null, loading: false, error: message });
      }
    };

    loadSummary();
    return () => {
      isActive = false;
    };
  }, [tenantId, buildingId, limit, userId]);

  const refetch = useCallback(async () => {
    if (!tenantId || !userId) return;

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const summary = await getInboxSummary(tenantId, buildingId, limit);
      setState({ summary, loading: false, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setState({ summary: null, loading: false, error: message });
    }
  }, [tenantId, buildingId, limit, userId]);

  return {
    ...state,
    refetch,
  };
}
