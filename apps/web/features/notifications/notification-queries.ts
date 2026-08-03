'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuthSession } from '@/features/auth/useAuthSession';
import type { ListNotificationsParams } from './notifications.api';

export interface NotificationQueryIdentity {
  readonly tenantId: string | null;
  readonly userId: string | null;
}

function normalizeTenantId(tenantId: string | null | undefined): string | null {
  if (typeof tenantId !== 'string') {
    return null;
  }

  const trimmed = tenantId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeListParams(params?: ListNotificationsParams): readonly [
  boolean | null,
  string | null,
  number,
  number,
] {
  return [
    params?.isRead ?? null,
    params?.type ?? null,
    params?.skip ?? 0,
    params?.take ?? 20,
  ] as const;
}

export const notificationQueryKeys = {
  scope(tenantId: string, userId: string): readonly ['notifications', string, string] {
    return ['notifications', tenantId, userId] as const;
  },
  unreadCount(tenantId: string, userId: string): readonly ['notifications', 'unread-count', string, string] {
    return ['notifications', 'unread-count', tenantId, userId] as const;
  },
  list(
    tenantId: string,
    userId: string,
    params?: ListNotificationsParams,
  ): readonly ['notifications', 'list', string, string, boolean | null, string | null, number, number] {
    const [isRead, type, skip, take] = normalizeListParams(params);
    return ['notifications', 'list', tenantId, userId, isRead, type, skip, take] as const;
  },
} as const;

export function useNotificationQueryIdentity(
  tenantId: string | null | undefined,
): NotificationQueryIdentity {
  const session = useAuthSession();

  return {
    tenantId: normalizeTenantId(tenantId),
    userId: session?.user.id ?? null,
  };
}

export function useNotificationQueryCleanup(identity: NotificationQueryIdentity): void {
  const queryClient = useQueryClient();
  const previousIdentityRef = useRef<NotificationQueryIdentity | null>(null);

  useEffect(() => {
    const previousIdentity = previousIdentityRef.current;
    const tenantChanged = previousIdentity?.tenantId !== identity.tenantId;
    const userChanged = previousIdentity?.userId !== identity.userId;

    if (previousIdentity && (tenantChanged || userChanged)) {
      if (previousIdentity.tenantId && previousIdentity.userId) {
        queryClient.removeQueries({
          queryKey: notificationQueryKeys.scope(previousIdentity.tenantId, previousIdentity.userId),
        });
      }
    }

    previousIdentityRef.current = identity;
  }, [identity, queryClient]);
}

export function removeNotificationQueries(
  queryClient: QueryClient,
  identity: NotificationQueryIdentity,
): void {
  if (!identity.tenantId || !identity.userId) {
    return;
  }

  queryClient.removeQueries({
    queryKey: notificationQueryKeys.scope(identity.tenantId, identity.userId),
  });
}
