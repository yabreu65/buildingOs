/**
 * useUnits Hook
 * Manages fetching and caching units from the API (tenant-level)
 */

import { useState, useEffect, useCallback } from 'react';
import {
  listUnitsByTenant,
  listUnitsByBuilding,
  createUnit as apiCreateUnit,
  updateUnit as apiUpdateUnit,
  deleteUnit as apiDeleteUnit,
  Unit,
  CreateUnitInput,
  UpdateUnitInput,
} from './units.api';

interface UseUnitsOptions {
  tenantId?: string;
  buildingId?: string | null; // Optional filter, null means no building selected (show nothing)
}

interface UseUnitsResult {
  units: Unit[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  createUnit: (buildingId: string, input: Omit<CreateUnitInput, 'buildingId'>) => Promise<Unit>;
  updateUnit: (buildingId: string, unitId: string, input: UpdateUnitInput) => Promise<Unit>;
  deleteUnit: (buildingId: string, unitId: string) => Promise<void>;
}

export function useUnits(options: UseUnitsOptions = {}): UseUnitsResult {
  const { tenantId, buildingId } = options;
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(!!tenantId); // Only load if tenantId is provided
  const [error, setError] = useState<Error | null>(null);

  // Fetch units from API
  const fetchUnits = useCallback(async () => {
    if (!tenantId) {
      setUnits([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await listUnitsByTenant(tenantId, buildingId);
      setUnits(data || []);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      setUnits([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, buildingId]);

  // Auto-fetch on mount or when dependencies change
  useEffect(() => {
    fetchUnits();
  }, [fetchUnits]);

  // Create unit
  const createUnit = useCallback(
    async (buildingId: string, input: Omit<CreateUnitInput, 'buildingId'>) => {
      if (!tenantId) throw new Error('Tenant ID is required');
      const newUnit = await apiCreateUnit(tenantId, buildingId, input);
      // Refresh list to ensure consistency
      await fetchUnits();
      return newUnit;
    },
    [tenantId, fetchUnits],
  );

  // Update unit
  const updateUnit = useCallback(
    async (buildingId: string, unitId: string, input: UpdateUnitInput) => {
      if (!tenantId) throw new Error('Tenant ID is required');
      const updated = await apiUpdateUnit(tenantId, buildingId, unitId, input);
      // Refresh list
      await fetchUnits();
      return updated;
    },
    [tenantId, fetchUnits],
  );

  // Delete unit
  const deleteUnit = useCallback(
    async (buildingId: string, unitId: string) => {
      if (!tenantId) throw new Error('Tenant ID is required');
      await apiDeleteUnit(tenantId, buildingId, unitId);
      // Refresh list
      await fetchUnits();
    },
    [tenantId, fetchUnits],
  );

  return {
    units,
    loading,
    error,
    refetch: fetchUnits,
    createUnit,
    updateUnit,
    deleteUnit,
  };
}
