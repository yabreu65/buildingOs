'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthSession } from '@/features/auth/useAuthSession';
import * as api from './notifications.api';
import type { Notification, ListNotificationsParams } from './notifications.api';
import {
  notificationQueryKeys,
  removeNotificationQueries,
  useNotificationQueryCleanup,
} from './notification-queries';

export function useNotifications(tenantId: string) {
  const queryClient = useQueryClient();
  const session = useAuthSession();
  const userId = session?.user.id ?? null;
  const identity = useMemo(
    () => ({
      tenantId: typeof tenantId === 'string' && tenantId.trim().length > 0 ? tenantId.trim() : null,
      userId,
    }),
    [tenantId, userId],
  );
  const identityKey = useMemo(
    () => (identity.tenantId && identity.userId ? `${identity.tenantId}::${identity.userId}` : ''),
    [identity.tenantId, identity.userId],
  );
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeIdentityKeyRef = useRef('');

  useNotificationQueryCleanup(identity);

  useEffect(() => {
    activeIdentityKeyRef.current = identityKey;
    setNotifications([]);
    setTotal(0);
    setUnreadCount(0);
    setLoading(false);
    setError(null);
  }, [identityKey]);

  const identityReady = Boolean(identity.tenantId && identity.userId);
  const resolvedTenantId = identity.tenantId;
  const resolvedUserId = identity.userId;

  const fetchUnreadCount = useCallback(async () => {
    if (!identityReady || !resolvedTenantId || !resolvedUserId) return 0;

    const requestIdentityKey = identityKey;
    try {
      const count = await queryClient.fetchQuery({
        queryKey: notificationQueryKeys.unreadCount(resolvedTenantId, resolvedUserId),
        queryFn: () => api.getUnreadCount(resolvedTenantId),
      });

      if (activeIdentityKeyRef.current === requestIdentityKey) {
        setUnreadCount(count);
      }

      return count;
    } catch (err) {
      if (activeIdentityKeyRef.current === requestIdentityKey) {
        setError(err instanceof Error ? err.message : 'Error al obtener notificaciones');
      }
      return 0;
    }
  }, [identityKey, identityReady, queryClient, resolvedTenantId, resolvedUserId]);

  const fetchNotifications = useCallback(
    async (params?: ListNotificationsParams) => {
      if (!identityReady || !resolvedTenantId || !resolvedUserId) return undefined;

      const requestIdentityKey = identityKey;
      setLoading(true);
      setError(null);

      try {
        const result = await queryClient.fetchQuery({
          queryKey: notificationQueryKeys.list(resolvedTenantId, resolvedUserId, params),
          queryFn: () => api.listNotifications(resolvedTenantId, params),
        });

        if (activeIdentityKeyRef.current === requestIdentityKey) {
          setNotifications(result.notifications);
          setTotal(result.total);
        }

        return result;
      } catch (err) {
        if (activeIdentityKeyRef.current === requestIdentityKey) {
          setError(err instanceof Error ? err.message : 'Error al obtener notificaciones');
        }
        return undefined;
      } finally {
        if (activeIdentityKeyRef.current === requestIdentityKey) {
          setLoading(false);
        }
      }
    },
    [identityKey, identityReady, queryClient, resolvedTenantId, resolvedUserId],
  );

  const invalidateCurrentNotificationQueries = useCallback(async () => {
    if (!identityReady || !resolvedTenantId || !resolvedUserId) return;

    await queryClient.invalidateQueries({
      queryKey: notificationQueryKeys.scope(resolvedTenantId, resolvedUserId),
    });
  }, [identityReady, queryClient, resolvedTenantId, resolvedUserId]);

  const markAsRead = useCallback(async (id: string) => {
    if (!identityReady || !resolvedTenantId || !resolvedUserId) return undefined;
    try {
      const updated = await api.markAsRead(resolvedTenantId, id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? updated : n)),
      );
      await invalidateCurrentNotificationQueries();
      await fetchUnreadCount();
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al marcar como leída');
      throw err;
    }
  }, [fetchUnreadCount, identityReady, invalidateCurrentNotificationQueries, resolvedTenantId, resolvedUserId]);

  const markAllAsRead = useCallback(async () => {
    if (!identityReady || !resolvedTenantId || !resolvedUserId) return undefined;
    try {
      const result = await api.markAllAsRead(resolvedTenantId);
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, isRead: true })),
      );
      await invalidateCurrentNotificationQueries();
      await fetchUnreadCount();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al marcar todas como leídas');
      throw err;
    }
  }, [fetchUnreadCount, identityReady, invalidateCurrentNotificationQueries, resolvedTenantId, resolvedUserId]);

  const deleteNotification = useCallback(async (id: string) => {
    if (!identityReady || !resolvedTenantId || !resolvedUserId) return undefined;
    try {
      await api.deleteNotification(resolvedTenantId, id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      setTotal((prev) => Math.max(0, prev - 1));
      await invalidateCurrentNotificationQueries();
      await fetchUnreadCount();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar notificación');
      throw err;
    }
  }, [fetchUnreadCount, identityReady, invalidateCurrentNotificationQueries, resolvedTenantId, resolvedUserId]);

  useEffect(() => {
    if (!identityReady) {
      return;
    }

    void fetchUnreadCount();
  }, [fetchUnreadCount, identityReady]);

  useEffect(() => {
    if (!identity.tenantId || !identity.userId) {
      return;
    }

    const cleanup = () => removeNotificationQueries(queryClient, identity);
    return cleanup;
  }, [identity, queryClient]);

  return {
    notifications,
    total,
    unreadCount,
    loading,
    error,
    fetch: fetchNotifications,
    fetchUnreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  };
}
