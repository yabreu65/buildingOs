'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { UserContext, ContextOptions } from './context.types';
import { getContext, setContext, getContextOptions } from './context.api';
import { useAuthorizedPortalContext } from '@/features/auth/useAuthorizedPortalContext';

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
  const session = useAuthSession();
  const userId = session?.user.id ?? null;
  const activeTenantId = session?.activeTenantId ?? null;
  const portalContext = useAuthorizedPortalContext(tenantId);
  const [state, setState] = useState<UseContextState>({
    context: null,
    options: null,
    loading: false,
    error: null,
  });

  // Load context and options on mount or when tenantId changes
  useEffect(() => {
    let isActive = true;
    const loadData = async () => {
      if (!tenantId || !userId) {
        setState({
          context: null,
          options: null,
          loading: false,
          error: null,
        });
        return;
      }

      if (activeTenantId !== tenantId) {
        setState({
          context: null,
          options: null,
          loading: false,
          error: null,
        });
        return;
      }

      setState({
        context: null,
        options: null,
        loading: true,
        error: null,
      });
      try {
        const [context, options] = await Promise.all([
          getContext(tenantId, portalContext),
          getContextOptions(tenantId, portalContext),
        ]);

        if (!isActive) return;

        setState((prev) => ({
          ...prev,
          context,
          options,
          loading: false,
        }));
      } catch (error) {
        if (!isActive) return;
        const message = error instanceof Error ? error.message : 'Unknown error';
        setState((prev) => ({ ...prev, loading: false, error: message }));
      }
    };

    loadData();
    return () => {
      isActive = false;
    };
  }, [tenantId, userId, activeTenantId, portalContext]);

  const setActiveBuilding = useCallback(
    async (buildingId: string | null) => {
      if (!tenantId || !state.context) return;

      try {
        const newContext = await setContext(tenantId, buildingId, null, portalContext);
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
    [tenantId, state.context, portalContext],
  );

  const setActiveUnit = useCallback(
    async (buildingId: string | null, unitId: string | null) => {
      if (!tenantId) return;

      try {
        const newContext = await setContext(tenantId, buildingId, unitId, portalContext);
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
    [tenantId, portalContext],
  );

  const refetch = useCallback(async () => {
    if (!tenantId || !userId || activeTenantId !== tenantId) return;

    setState({
      context: null,
      options: null,
      loading: true,
      error: null,
    });
    try {
      const [context, options] = await Promise.all([
        getContext(tenantId, portalContext),
        getContextOptions(tenantId, portalContext),
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
  }, [tenantId, userId, activeTenantId, portalContext]);

  return {
    ...state,
    setActiveBuilding,
    setActiveUnit,
    refetch,
  };
}
