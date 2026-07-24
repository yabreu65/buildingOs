'use client';

import { useQuery } from '@tanstack/react-query';
import { getTicketByTenant, type Ticket } from '../services/tickets.api';

export const ticketDetailKeys = {
  all: () => ['ticket-detail'] as const,
  byTenant: (tenantId: string, ticketId: string) => ['ticket-detail', tenantId, ticketId] as const,
};

export function useTicketDetail(tenantId: string | undefined, ticketId: string | undefined) {
  return useQuery<Ticket>({
    queryKey: tenantId && ticketId
      ? ticketDetailKeys.byTenant(tenantId, ticketId)
      : ticketDetailKeys.all(),
    queryFn: async () => {
      if (!tenantId || !ticketId) {
        throw new Error('Missing tenantId or ticketId');
      }

      return getTicketByTenant(tenantId, ticketId);
    },
    enabled: !!tenantId && !!ticketId,
  });
}
