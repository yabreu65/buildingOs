/**
 * useCommunicationsAdmin Hook
 * Manages admin communications (CRUD)
 */

import { useState, useCallback, useEffect } from 'react';
import {
  listCommunications,
  getCommunication,
  createCommunication,
  updateCommunication,
  sendCommunication,
  deleteCommunication,
  type Communication,
  type CreateCommunicationInput,
  type UpdateCommunicationInput,
} from '../services/communications.api';

interface UseCommunicationsAdminOptions {
  buildingId?: string;
  tenantId?: string;
  filters?: {
    status?: 'DRAFT' | 'SCHEDULED' | 'SENT';
  };
}

export function useCommunicationsAdmin(options: UseCommunicationsAdminOptions) {
  const { buildingId, tenantId, filters } = options;

  const [communications, setCommunications] = useState<Communication[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch all communications
  const fetchCommunications = useCallback(async () => {
    if (!buildingId || !tenantId) {
      setCommunications([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await listCommunications(buildingId, tenantId, filters);
      setCommunications(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch communications';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [buildingId, tenantId, filters]);

  // Auto-fetch on mount and dependency changes
  useEffect(() => {
    fetchCommunications();
  }, [fetchCommunications]);

  // Fetch single communication
  const fetch = useCallback(
    async (communicationId: string): Promise<Communication | null> => {
      if (!buildingId || !tenantId) return null;
      try {
        return await getCommunication(buildingId, communicationId, tenantId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch communication';
        setError(message);
        return null;
      }
    },
    [buildingId, tenantId]
  );

  // Create communication
  const create = useCallback(
    async (input: CreateCommunicationInput): Promise<Communication | null> => {
      if (!buildingId || !tenantId) return null;
      try {
        const newComm = await createCommunication(buildingId, tenantId, input);
        setCommunications((prev) => [newComm, ...prev]);
        return newComm;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create communication';
        setError(message);
        throw err;
      }
    },
    [buildingId, tenantId]
  );

  // Update communication
  const update = useCallback(
    async (communicationId: string, input: UpdateCommunicationInput): Promise<Communication | null> => {
      if (!buildingId || !tenantId) return null;
      try {
        const updated = await updateCommunication(buildingId, communicationId, tenantId, input);
        setCommunications((prev) =>
          prev.map((c) => (c.id === communicationId ? updated : c))
        );
        return updated;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update communication';
        setError(message);
        throw err;
      }
    },
    [buildingId, tenantId]
  );

  // Send communication (DRAFT → SENT/SCHEDULED)
  const send = useCallback(
    async (communicationId: string): Promise<Communication | null> => {
      if (!buildingId || !tenantId) return null;
      try {
        const sent = await sendCommunication(buildingId, communicationId, tenantId);
        setCommunications((prev) =>
          prev.map((c) => (c.id === communicationId ? sent : c))
        );
        return sent;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to send communication';
        setError(message);
        throw err;
      }
    },
    [buildingId, tenantId]
  );

  // Delete communication
  const remove = useCallback(
    async (communicationId: string): Promise<void> => {
      if (!buildingId || !tenantId) return;
      try {
        await deleteCommunication(buildingId, communicationId, tenantId);
        setCommunications((prev) =>
          prev.filter((c) => c.id !== communicationId)
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete communication';
        setError(message);
        throw err;
      }
    },
    [buildingId, tenantId]
  );

  // Refetch communications
  const refetch = useCallback(() => {
    fetchCommunications();
  }, [fetchCommunications]);

  return {
    communications,
    loading,
    error,
    fetch,
    create,
    update,
    send,
    remove,
    refetch,
  };
}
