/**
 * useTickets Hook
 * Manages tickets state and operations (fetch, create, update, comment)
 */

import { useState, useCallback, useEffect } from 'react';
import {
  listTickets,
  getTicket,
  createTicket,
  updateTicket,
  addComment,
  getComments,
  type Ticket,
  type CreateTicketInput,
  type UpdateTicketInput,
  type CreateCommentInput,
} from '../services/tickets.api';

interface UseTicketsOptions {
  buildingId?: string;
  filters?: {
    status?: string;
    priority?: string;
    unitId?: string;
    assignedToMembership?: string;
  };
}

export function useTickets(options: UseTicketsOptions) {
  const { buildingId, filters } = options;

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch all tickets
  const fetchTickets = useCallback(async () => {
    if (!buildingId) {
      setTickets([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await listTickets(buildingId, filters);
      setTickets(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch tickets';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [buildingId, filters]);

  // Auto-fetch on mount and dependency changes
  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  // Fetch single ticket
  const fetch = useCallback(
    async (ticketId: string): Promise<Ticket | null> => {
      if (!buildingId) return null;
      try {
        return await getTicket(buildingId, ticketId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch ticket';
        setError(message);
        return null;
      }
    },
    [buildingId]
  );

  // Create ticket
  const create = useCallback(
    async (input: CreateTicketInput): Promise<Ticket | null> => {
      if (!buildingId) return null;
      try {
        const newTicket = await createTicket(buildingId, input);
        setTickets((prev) => [newTicket, ...prev]); // Add to beginning of list
        return newTicket;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create ticket';
        setError(message);
        throw err;
      }
    },
    [buildingId]
  );

  // Update ticket
  const update = useCallback(
    async (ticketId: string, input: UpdateTicketInput): Promise<Ticket | null> => {
      if (!buildingId) return null;
      try {
        const updated = await updateTicket(buildingId, ticketId, input);
        setTickets((prev) =>
          prev.map((t) => (t.id === ticketId ? updated : t))
        );
        return updated;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update ticket';
        setError(message);
        throw err;
      }
    },
    [buildingId]
  );

  // Add comment
  const addNewComment = useCallback(
    async (ticketId: string, input: CreateCommentInput) => {
      if (!buildingId) return;
      try {
        await addComment(buildingId, ticketId, input);
        // Refresh the specific ticket to get updated comments
        const updated = await fetch(ticketId);
        if (updated) {
          setTickets((prev) =>
            prev.map((t) => (t.id === ticketId ? updated : t))
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add comment';
        setError(message);
        throw err;
      }
    },
    [buildingId, fetch]
  );

  // Refetch tickets
  const refetch = useCallback(() => {
    fetchTickets();
  }, [fetchTickets]);

  return {
    tickets,
    loading,
    error,
    fetch,
    create,
    update,
    addComment: addNewComment,
    refetch,
  };
}
