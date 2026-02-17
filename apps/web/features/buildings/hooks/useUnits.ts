'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Unit } from '@/features/units/units.types';
import * as buildingsApi from '../services/buildings.api';

export interface UseUnitsState {
  units: Unit[];
  loading: boolean;
  error: string | null;
}

export interface UseUnits extends UseUnitsState {
  // Queries
  refetch: () => Promise<void>;

  // Mutations
  create: (data: {
    code: string;
    label?: string;
    unitType?: string;
    occupancyStatus?: string;
  }) => Promise<Unit>;
  update: (
    unitId: string,
    data: {
      code?: string;
      label?: string;
      unitType?: string;
      occupancyStatus?: string;
    }
  ) => Promise<Unit>;
  delete: (unitId: string) => Promise<void>;
}

/**
 * useUnits: Fetch and manage units for a building
 * Handles loading, error states, and provides CRUD operations
 */
export function useUnits(
  tenantId: string | undefined,
  buildingId: string | undefined
): UseUnits {
  const [state, setState] = useState<UseUnitsState>(() => ({
    units: [],
    loading: !!(tenantId && buildingId), // only loading if both params are provided
    error: null,
  }));

  // Fetch units
  const refetch = useCallback(async () => {
    if (!tenantId || !buildingId) return;

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const units = await buildingsApi.fetchUnits(tenantId, buildingId);
      setState({ units, loading: false, error: null });
    } catch (err) {
      setState({
        units: [],
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch units',
      });
    }
  }, [tenantId, buildingId]);

  // Auto-fetch on mount or params change
  useEffect(() => {
    refetch();
  }, [refetch]);

  // Create unit
  const create = useCallback(
    async (data: {
      code: string;
      label?: string;
      unitType?: string;
      occupancyStatus?: string;
    }) => {
      if (!tenantId || !buildingId) throw new Error('Missing tenant or building ID');

      try {
        const newUnit = await buildingsApi.createUnit(tenantId, buildingId, data);
        setState((prev) => ({
          ...prev,
          units: [...prev.units, newUnit],
        }));
        return newUnit;
      } catch (err) {
        throw err instanceof Error ? err : new Error('Failed to create unit');
      }
    },
    [tenantId, buildingId]
  );

  // Update unit
  const update = useCallback(
    async (
      unitId: string,
      data: {
        code?: string;
        label?: string;
        unitType?: string;
        occupancyStatus?: string;
      }
    ) => {
      if (!tenantId || !buildingId) throw new Error('Missing tenant or building ID');

      try {
        const updated = await buildingsApi.updateUnit(tenantId, buildingId, unitId, data);
        setState((prev) => ({
          ...prev,
          units: prev.units.map((u) => (u.id === unitId ? updated : u)),
        }));
        return updated;
      } catch (err) {
        throw err instanceof Error ? err : new Error('Failed to update unit');
      }
    },
    [tenantId, buildingId]
  );

  // Delete unit
  const remove = useCallback(
    async (unitId: string) => {
      if (!tenantId || !buildingId) throw new Error('Missing tenant or building ID');

      try {
        await buildingsApi.deleteUnit(tenantId, buildingId, unitId);
        setState((prev) => ({
          ...prev,
          units: prev.units.filter((u) => u.id !== unitId),
        }));
      } catch (err) {
        throw err instanceof Error ? err : new Error('Failed to delete unit');
      }
    },
    [tenantId, buildingId]
  );

  return {
    ...state,
    refetch,
    create,
    update,
    delete: remove,
  };
}
