'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Building } from '@/features/units/units.types';
import * as buildingsApi from '../services/buildings.api';

export interface UseBuilingsState {
  buildings: Building[];
  loading: boolean;
  error: string | null;
}

export interface UseBuildings extends UseBuilingsState {
  // Queries
  refetch: () => Promise<void>;

  // Mutations
  create: (data: { name: string; address?: string }) => Promise<Building>;
  update: (
    buildingId: string,
    data: { name?: string; address?: string }
  ) => Promise<Building>;
  delete: (buildingId: string) => Promise<void>;
}

/**
 * useBuildings: Fetch and manage buildings for a tenant
 * Handles loading, error states, and provides CRUD operations
 */
export function useBuildings(tenantId: string | undefined): UseBuildings {
  const [state, setState] = useState<UseBuilingsState>(() => ({
    buildings: [],
    loading: !!tenantId, // only loading if tenantId is provided
    error: null,
  }));

  // Fetch buildings
  const refetch = useCallback(async () => {
    if (!tenantId) return;

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const buildings = await buildingsApi.fetchBuildings(tenantId);
      setState({ buildings, loading: false, error: null });
    } catch (err) {
      setState({
        buildings: [],
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch buildings',
      });
    }
  }, [tenantId]);

  // Auto-fetch on mount or tenantId change
  useEffect(() => {
    refetch();
  }, [refetch]);

  // Create building
  const create = useCallback(
    async (data: { name: string; address?: string }) => {
      if (!tenantId) throw new Error('No tenant ID');

      try {
        const newBuilding = await buildingsApi.createBuilding(tenantId, data);
        setState((prev) => ({
          ...prev,
          buildings: [...prev.buildings, newBuilding],
        }));
        return newBuilding;
      } catch (err) {
        throw err instanceof Error ? err : new Error('Failed to create building');
      }
    },
    [tenantId]
  );

  // Update building
  const update = useCallback(
    async (buildingId: string, data: { name?: string; address?: string }) => {
      if (!tenantId) throw new Error('No tenant ID');

      try {
        const updated = await buildingsApi.updateBuilding(tenantId, buildingId, data);
        setState((prev) => ({
          ...prev,
          buildings: prev.buildings.map((b) => (b.id === buildingId ? updated : b)),
        }));
        return updated;
      } catch (err) {
        throw err instanceof Error ? err : new Error('Failed to update building');
      }
    },
    [tenantId]
  );

  // Delete building
  const remove = useCallback(
    async (buildingId: string) => {
      if (!tenantId) throw new Error('No tenant ID');

      try {
        await buildingsApi.deleteBuilding(tenantId, buildingId);
        setState((prev) => ({
          ...prev,
          buildings: prev.buildings.filter((b) => b.id !== buildingId),
        }));
      } catch (err) {
        throw err instanceof Error ? err : new Error('Failed to delete building');
      }
    },
    [tenantId]
  );

  return {
    ...state,
    refetch,
    create,
    update,
    delete: remove,
  };
}
