'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Occupant } from '../services/buildings.api';
import * as buildingsApi from '../services/buildings.api';

export interface UseOccupantsState {
  occupants: Occupant[];
  loading: boolean;
  error: string | null;
}

export interface UseOccupants extends UseOccupantsState {
  // Queries
  refetch: () => Promise<void>;

  // Mutations
  assign: (data: { userId: string; role: 'OWNER' | 'RESIDENT' }) => Promise<Occupant>;
  remove: (occupantId: string) => Promise<void>;
}

/**
 * useOccupants: Fetch and manage occupants for a unit
 * Handles loading, error states, and provides assignment/removal operations
 */
export function useOccupants(
  tenantId: string | undefined,
  buildingId: string | undefined,
  unitId: string | undefined
): UseOccupants {
  const [state, setState] = useState<UseOccupantsState>(() => ({
    occupants: [],
    loading: !!(tenantId && buildingId && unitId), // only loading if all params are provided
    error: null,
  }));

  // Fetch occupants
  const refetch = useCallback(async () => {
    if (!tenantId || !buildingId || !unitId) return;

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const occupants = await buildingsApi.fetchOccupants(tenantId, buildingId, unitId);
      setState({ occupants, loading: false, error: null });
    } catch (err) {
      setState({
        occupants: [],
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch occupants',
      });
    }
  }, [tenantId, buildingId, unitId]);

  // Auto-fetch on mount or params change
  useEffect(() => {
    refetch();
  }, [refetch]);

  // Assign occupant
  const assign = useCallback(
    async (data: { userId: string; role: 'OWNER' | 'RESIDENT' }) => {
      if (!tenantId || !buildingId || !unitId) {
        throw new Error('Missing tenant, building, or unit ID');
      }

      try {
        const newOccupant = await buildingsApi.assignOccupant(
          tenantId,
          buildingId,
          unitId,
          data
        );
        setState((prev) => ({
          ...prev,
          occupants: [...prev.occupants, newOccupant],
        }));
        return newOccupant;
      } catch (err) {
        throw err instanceof Error ? err : new Error('Failed to assign occupant');
      }
    },
    [tenantId, buildingId, unitId]
  );

  // Remove occupant
  const removeOccupant = useCallback(
    async (occupantId: string) => {
      if (!tenantId || !buildingId || !unitId) {
        throw new Error('Missing tenant, building, or unit ID');
      }

      try {
        await buildingsApi.removeOccupant(tenantId, buildingId, unitId, occupantId);
        setState((prev) => ({
          ...prev,
          occupants: prev.occupants.filter((o) => o.id !== occupantId),
        }));
      } catch (err) {
        throw err instanceof Error ? err : new Error('Failed to remove occupant');
      }
    },
    [tenantId, buildingId, unitId]
  );

  return {
    ...state,
    refetch,
    assign,
    remove: removeOccupant,
  };
}
