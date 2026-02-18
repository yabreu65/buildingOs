'use client';

import { useState, useEffect, useCallback } from 'react';
import { UserContext, ContextOptions } from './context.types';
import { getContext, setContext, getContextOptions } from './context.api';

interface UseContextState {
  context: UserContext | null;
  options: ContextOptions | null;
  loading: boolean;
  error: string | null;
}

/**
 * Custom hook for managing user context (active building/unit)
 *
 * Usage:
 * const {
 *   context,
 *   options,
 *   loading,
 *   error,
 *   setActiveBuilding,
 *   setActiveUnit,
 *   refetch,
 * } = useContext(tenantId);
 */
export function useContextManager(tenantId: string | null) {
  const [state, setState] = useState<UseContextState>({
    context: null,
    options: null,
    loading: false,
    error: null,
  });

  // Load context and options on mount or when tenantId changes
  useEffect(() => {
    if (!tenantId) return;

    const loadData = async () => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const [context, options] = await Promise.all([
          getContext(tenantId),
          getContextOptions(tenantId),
        ]);

        setState((prev) => ({
          ...prev,
          context,
          options,
          loading: false,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setState((prev) => ({ ...prev, loading: false, error: message }));
      }
    };

    loadData();
  }, [tenantId]);

  const setActiveBuilding = useCallback(
    async (buildingId: string | null) => {
      if (!tenantId || !state.context) return;

      try {
        const newContext = await setContext(tenantId, buildingId, null);
        setState((prev) => ({
          ...prev,
          context: newContext,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setState((prev) => ({ ...prev, error: message }));
        throw error;
      }
    },
    [tenantId, state.context],
  );

  const setActiveUnit = useCallback(
    async (buildingId: string | null, unitId: string | null) => {
      if (!tenantId) return;

      try {
        const newContext = await setContext(tenantId, buildingId, unitId);
        setState((prev) => ({
          ...prev,
          context: newContext,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        setState((prev) => ({ ...prev, error: message }));
        throw error;
      }
    },
    [tenantId],
  );

  const refetch = useCallback(async () => {
    if (!tenantId) return;

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [context, options] = await Promise.all([
        getContext(tenantId),
        getContextOptions(tenantId),
      ]);

      setState((prev) => ({
        ...prev,
        context,
        options,
        loading: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setState((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, [tenantId]);

  return {
    ...state,
    setActiveBuilding,
    setActiveUnit,
    refetch,
  };
}
