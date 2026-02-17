/**
 * useVendors Hook
 * Manages vendors and assignments state for a building
 */

import { useState, useCallback, useEffect } from 'react';
import {
  listAllVendors,
  listBuildingVendors,
  createVendor,
  createVendorAssignment,
  deleteVendorAssignment,
  type Vendor,
  type VendorAssignment,
  type CreateVendorInput,
  type CreateVendorAssignmentInput,
} from '../services/vendors.api';

interface UseVendorsOptions {
  buildingId?: string;
}

export function useVendors(options: UseVendorsOptions) {
  const { buildingId } = options;

  const [assignments, setAssignments] = useState<VendorAssignment[]>([]);
  const [allVendors, setAllVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch vendors and assignments
  const fetchVendors = useCallback(async () => {
    if (!buildingId) {
      setAssignments([]);
      setAllVendors([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [assignmentsData, allVendorsData] = await Promise.all([
        listBuildingVendors(buildingId),
        listAllVendors(),
      ]);
      setAssignments(assignmentsData);
      setAllVendors(allVendorsData);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch vendors';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [buildingId]);

  // Auto-fetch on mount and dependency changes
  useEffect(() => {
    fetchVendors();
  }, [fetchVendors]);

  // Create a new vendor and optionally assign it
  const createAndAssign = useCallback(
    async (vendorInput: CreateVendorInput, serviceType: string): Promise<VendorAssignment | null> => {
      if (!buildingId) return null;
      try {
        const newVendor = await createVendor(vendorInput);
        const assignment = await createVendorAssignment(buildingId, {
          vendorId: newVendor.id,
          serviceType,
        });
        setAssignments((prev) => [assignment, ...prev]);
        setAllVendors((prev) => [newVendor, ...prev]);
        return assignment;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create vendor';
        setError(message);
        throw err;
      }
    },
    [buildingId]
  );

  // Assign existing vendor
  const assignVendor = useCallback(
    async (input: CreateVendorAssignmentInput): Promise<VendorAssignment | null> => {
      if (!buildingId) return null;
      try {
        const assignment = await createVendorAssignment(buildingId, input);
        setAssignments((prev) => [assignment, ...prev]);
        return assignment;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to assign vendor';
        setError(message);
        throw err;
      }
    },
    [buildingId]
  );

  // Remove a vendor assignment
  const removeAssignment = useCallback(
    async (assignmentId: string) => {
      if (!buildingId) return;
      try {
        await deleteVendorAssignment(buildingId, assignmentId);
        setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to remove assignment';
        setError(message);
        throw err;
      }
    },
    [buildingId]
  );

  // Refetch vendors
  const refetch = useCallback(() => {
    fetchVendors();
  }, [fetchVendors]);

  return {
    assignments,
    allVendors,
    loading,
    error,
    createAndAssign,
    assignVendor,
    removeAssignment,
    refetch,
  };
}
