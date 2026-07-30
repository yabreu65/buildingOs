'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthSession } from '@/features/auth/useAuthSession';
import {
  getInbox,
  markAsRead as markAsReadAPI,
  type InboxCommunication,
} from '../services/communications.api';

interface UseCommunicationsInboxOptions {
  buildingId?: string;
  unitId?: string;
  tenantId?: string | null;
}

const COMMUNICATIONS_INBOX_QUERY_KEY = 'communicationsInbox';

export function useCommunicationsInbox(options: UseCommunicationsInboxOptions) {
  const { buildingId, unitId, tenantId } = options;
  const session = useAuthSession();
  const queryClient = useQueryClient();
  const userId = session?.user.id ?? null;
  const activeTenantId = session?.activeTenantId ?? null;
  const requestedTenantId = tenantId?.trim() ?? null;
  const canFetch = !!requestedTenantId && !!userId && requestedTenantId === activeTenantId;

  const inboxQuery = useQuery<InboxCommunication[]>({
    queryKey: [
      COMMUNICATIONS_INBOX_QUERY_KEY,
      requestedTenantId,
      activeTenantId,
      buildingId,
      unitId,
      userId,
    ],
    queryFn: () => {
      if (!requestedTenantId) {
        throw new Error('Missing tenantId for inbox query');
      }

      return getInbox(
        requestedTenantId,
        buildingId || unitId ? { buildingId, unitId } : undefined,
      );
    },
    enabled: canFetch,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });

  const inbox = useMemo(() => {
    return canFetch ? inboxQuery.data ?? [] : [];
  }, [canFetch, inboxQuery.data]);

  const markAsReadMutation = useMutation({
    mutationFn: async (communicationId: string) => {
      if (!requestedTenantId) {
        throw new Error('Missing tenantId for inbox mutation');
      }

      await markAsReadAPI(requestedTenantId, communicationId);
      return communicationId;
    },
    onSuccess: async (communicationId) => {
      if (!requestedTenantId) {
        return;
      }

      const queryKey = [
        COMMUNICATIONS_INBOX_QUERY_KEY,
        requestedTenantId,
        activeTenantId,
        buildingId,
        unitId,
        userId,
      ];
      const now = new Date().toISOString();

      queryClient.setQueryData<InboxCommunication[]>(queryKey, (current) =>
        current?.map((communication) => {
          if (communication.id !== communicationId) {
            return communication;
          }

          return {
            ...communication,
            receipts: communication.receipts.map((receipt) => ({
              ...receipt,
              readAt: receipt.readAt ?? now,
            })),
          };
        }) ?? current,
      );

      await queryClient.invalidateQueries({
        queryKey: [COMMUNICATIONS_INBOX_QUERY_KEY, requestedTenantId, activeTenantId],
        exact: false,
      });
    },
  });

  const unreadCount = useMemo(() => {
    return inbox.filter((communication) => {
      const receipt = communication.receipts?.[0];
      return !receipt?.readAt;
    }).length;
  }, [inbox]);

  return {
    inbox,
    loading: canFetch ? inboxQuery.isLoading : false,
    error: inboxQuery.error instanceof Error ? inboxQuery.error.message : null,
    markAsRead: markAsReadMutation.mutateAsync,
    unreadCount,
    refetch: inboxQuery.refetch,
  };
}
