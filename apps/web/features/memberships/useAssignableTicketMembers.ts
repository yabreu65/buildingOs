'use client';

import { useQuery } from '@tanstack/react-query';
import {
  listAssignableTicketMembers,
  type AssignableTicketMember,
} from './memberships.api';

export const assignableTicketMembersKeys = {
  all: (tenantId: string) => ['assignableTicketMembers', tenantId] as const,
};

export function useAssignableTicketMembers(tenantId: string) {
  const query = useQuery({
    queryKey: assignableTicketMembersKeys.all(tenantId),
    queryFn: () => listAssignableTicketMembers(tenantId),
    enabled: !!tenantId,
  });

  return {
    ...query,
    data: (query.data ?? []) as AssignableTicketMember[],
  };
}
