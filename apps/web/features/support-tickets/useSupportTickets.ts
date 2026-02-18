'use client';

import { useState, useCallback } from 'react';
import * as api from './support-tickets.api';

export function useSupportTickets(tenantId?: string, isSuperAdmin = false) {
  const [tickets, setTickets] = useState<api.SupportTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(
    async (params?: { status?: string; category?: string; skip?: number; take?: number }) => {
      setLoading(true);
      setError(null);

      try {
        if (isSuperAdmin) {
          const result = await api.listAllSupportTickets(params);
          setTickets(result.tickets);
          setTotal(result.total);
        } else if (tenantId) {
          const result = await api.listTenantSupportTickets(tenantId, params);
          setTickets(result.tickets);
          setTotal(result.total);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch tickets');
      } finally {
        setLoading(false);
      }
    },
    [tenantId, isSuperAdmin],
  );

  const create = useCallback(
    async (data: { title: string; description: string; category?: string; priority?: string }) => {
      if (!tenantId) {
        throw new Error('Tenant ID required');
      }

      try {
        const ticket = await api.createSupportTicket(tenantId, data);
        setTickets([ticket, ...tickets]);
        return ticket;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create ticket';
        setError(message);
        throw err;
      }
    },
    [tenantId, tickets],
  );

  const update = useCallback(
    async (id: string, data: { title?: string; description?: string; priority?: string }) => {
      if (isSuperAdmin) {
        const updated = await api.updateSupportTicket(id, data);
        setTickets(tickets.map((t) => (t.id === id ? updated : t)));
        return updated;
      } else if (tenantId) {
        const updated = await api.updateTenantSupportTicket(tenantId, id, data);
        setTickets(tickets.map((t) => (t.id === id ? updated : t)));
        return updated;
      }
    },
    [tenantId, tickets, isSuperAdmin],
  );

  const updateStatus = useCallback(
    async (id: string, status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED') => {
      if (!isSuperAdmin) {
        throw new Error('Only super admin can change status');
      }

      const updated = await api.updateSupportTicketStatus(id, status);
      setTickets(tickets.map((t) => (t.id === id ? updated : t)));
      return updated;
    },
    [tickets, isSuperAdmin],
  );

  const assign = useCallback(
    async (id: string, assignedToUserId?: string) => {
      if (!isSuperAdmin) {
        throw new Error('Only super admin can assign');
      }

      const updated = await api.assignSupportTicket(id, assignedToUserId);
      setTickets(tickets.map((t) => (t.id === id ? updated : t)));
      return updated;
    },
    [tickets, isSuperAdmin],
  );

  const close = useCallback(
    async (id: string) => {
      if (!isSuperAdmin) {
        throw new Error('Only super admin can close');
      }

      const updated = await api.closeSupportTicket(id);
      setTickets(tickets.map((t) => (t.id === id ? updated : t)));
      return updated;
    },
    [tickets, isSuperAdmin],
  );

  const addComment = useCallback(
    async (id: string, body: string) => {
      try {
        if (isSuperAdmin) {
          return await api.addSupportTicketComment(id, body);
        } else if (tenantId) {
          return await api.addTenantSupportTicketComment(tenantId, id, body);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add comment';
        setError(message);
        throw err;
      }
    },
    [tenantId, isSuperAdmin],
  );

  return {
    tickets,
    total,
    loading,
    error,
    fetch,
    create,
    update,
    updateStatus,
    assign,
    close,
    addComment,
  };
}
