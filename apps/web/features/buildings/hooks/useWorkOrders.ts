/**
 * useWorkOrders Hook
 * Manages work orders state for a building
 */

import { useState, useCallback, useEffect } from 'react';
import {
  listWorkOrders,
  createWorkOrder,
  updateWorkOrder,
  type WorkOrder,
  type CreateWorkOrderInput,
  type UpdateWorkOrderInput,
} from '../services/vendors.api';

interface UseWorkOrdersOptions {
  buildingId?: string;
  filters?: {
    status?: string;
    ticketId?: string;
  };
}

export function useWorkOrders(options: UseWorkOrdersOptions) {
  const { buildingId, filters } = options;

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch all work orders
  const fetchWorkOrders = useCallback(async () => {
    if (!buildingId) {
      setWorkOrders([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await listWorkOrders(buildingId, filters);
      setWorkOrders(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch work orders';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [buildingId, filters]);

  // Auto-fetch on mount and dependency changes
  useEffect(() => {
    fetchWorkOrders();
  }, [fetchWorkOrders]);

  // Create a new work order
  const create = useCallback(
    async (input: CreateWorkOrderInput): Promise<WorkOrder | null> => {
      if (!buildingId) return null;
      try {
        const newWorkOrder = await createWorkOrder(buildingId, input);
        setWorkOrders((prev) => [newWorkOrder, ...prev]);
        return newWorkOrder;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create work order';
        setError(message);
        throw err;
      }
    },
    [buildingId]
  );

  // Update work order status
  const updateStatus = useCallback(
    async (workOrderId: string, status: string): Promise<WorkOrder | null> => {
      if (!buildingId) return null;
      try {
        const updated = await updateWorkOrder(buildingId, workOrderId, { status: status as any });
        setWorkOrders((prev) =>
          prev.map((w) => (w.id === workOrderId ? updated : w))
        );
        return updated;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update work order';
        setError(message);
        throw err;
      }
    },
    [buildingId]
  );

  // Refetch work orders
  const refetch = useCallback(() => {
    fetchWorkOrders();
  }, [fetchWorkOrders]);

  return {
    workOrders,
    loading,
    error,
    create,
    updateStatus,
    refetch,
  };
}
