/**
 * useCommunicationsAdmin Hook
 * Manages admin communications (CRUD) with search, filter, and sort state
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  listCommunications,
  getCommunication,
  createCommunication,
  updateCommunication,
  sendCommunication,
  deleteCommunication,
  type Communication,
  type CommunicationStatus,
  type CommunicationChannel,
  type CreateCommunicationInput,
  type UpdateCommunicationInput,
} from '../services/communications.api';

interface UseCommunicationsAdminOptions {
  buildingId?: string;
  tenantId?: string;
}

export interface CommunicationsAdminFilters {
  status: 'all' | CommunicationStatus;
  channel: 'all' | CommunicationChannel;
  search: string;
  sortOrder: 'asc' | 'desc';
}

/**
 * useCommunicationsAdmin: Hook for managing admin communications.
 * Handles CRUD operations with search, filter, and sort state.
 * Calculates KPI metrics (draft, scheduled, sent counts) from loaded data.
 */
export function useCommunicationsAdmin(options: UseCommunicationsAdminOptions) {
  const { buildingId, tenantId } = options;

  const [communications, setCommunications] = useState<Communication[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<CommunicationsAdminFilters>({
    status: 'all',
    channel: 'all',
    search: '',
    sortOrder: 'desc',
  });

  // Fetch all communications (with backend filters applied)
  const fetchCommunications = useCallback(async () => {
    if (!buildingId || !tenantId) {
      setCommunications([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await listCommunications(buildingId, tenantId, {
        status: filters.status !== 'all' ? filters.status : undefined,
        channel: filters.channel !== 'all' ? filters.channel : undefined,
        search: filters.search || undefined,
        sortBy: 'createdAt',
        sortOrder: filters.sortOrder,
      });
      setCommunications(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cargar comunicados';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [buildingId, tenantId, filters]);

  useEffect(() => {
    fetchCommunications();
  }, [fetchCommunications]);

  // KPI metrics derived from current list
  const metrics = useMemo(() => {
    const sentComms = communications.filter((c) => c.status === 'SENT');
    const totalRecipients = sentComms.reduce((acc, c) => acc + (c.receipts?.length || 0), 0);
    const totalRead = sentComms.reduce(
      (acc, c) => acc + (c.receipts?.filter((r) => r.readAt).length || 0),
      0
    );

    return {
      sent: sentComms.length,
      drafts: communications.filter((c) => c.status === 'DRAFT').length,
      scheduled: communications.filter((c) => c.status === 'SCHEDULED').length,
      readRate: totalRecipients > 0 ? Math.round((totalRead / totalRecipients) * 100) : 0,
    };
  }, [communications]);

  // Fetch single communication
  const fetchOne = useCallback(
    async (communicationId: string): Promise<Communication | null> => {
      if (!buildingId || !tenantId) return null;
      try {
        return await getCommunication(buildingId, communicationId, tenantId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error al cargar comunicado';
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
        const message = err instanceof Error ? err.message : 'Error al crear comunicado';
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
        const message = err instanceof Error ? err.message : 'Error al actualizar comunicado';
        setError(message);
        throw err;
      }
    },
    [buildingId, tenantId]
  );

  // Send communication (DRAFT → SENT/SCHEDULED)
  const send = useCallback(
    async (communicationId: string, scheduledAt?: Date): Promise<Communication | null> => {
      if (!buildingId || !tenantId) return null;
      try {
        const sent = await sendCommunication(buildingId, communicationId, tenantId, scheduledAt);
        setCommunications((prev) =>
          prev.map((c) => (c.id === communicationId ? sent : c))
        );
        return sent;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error al publicar comunicado';
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
        const message = err instanceof Error ? err.message : 'Error al eliminar comunicado';
        setError(message);
        throw err;
      }
    },
    [buildingId, tenantId]
  );

  const refetch = useCallback(() => {
    fetchCommunications();
  }, [fetchCommunications]);

  return {
    communications,
    loading,
    error,
    filters,
    setFilters,
    metrics,
    fetchOne,
    create,
    update,
    send,
    remove,
    refetch,
  };
}
