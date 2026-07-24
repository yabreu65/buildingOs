'use client';

import { useState, useCallback, useEffect } from 'react';
import * as api from './notifications.api';
import type { Notification, ListNotificationsParams } from './notifications.api';

export function useNotifications(tenantId: string) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = useCallback(
    async (params?: ListNotificationsParams) => {
      if (!tenantId) return;
      setLoading(true);
      setError(null);

      try {
        const result = await api.listNotifications(tenantId, params);
        setNotifications(result.notifications);
        setTotal(result.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al obtener notificaciones');
      } finally {
        setLoading(false);
      }
    },
    [tenantId],
  );

  const fetchUnreadCount = useCallback(async () => {
    if (!tenantId) return;
    try {
      const count = await api.getUnreadCount(tenantId);
      setUnreadCount(count);
    } catch {
      // silently ignore — badge will retry on next poll
    }
  }, [tenantId]);

  const markAsRead = useCallback(async (id: string) => {
    if (!tenantId) return;
    try {
      const updated = await api.markAsRead(tenantId, id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? updated : n)),
      );
      await fetchUnreadCount();
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al marcar como leída');
      throw err;
    }
  }, [tenantId, fetchUnreadCount]);

  const markAllAsRead = useCallback(async () => {
    if (!tenantId) return;
    try {
      const result = await api.markAllAsRead(tenantId);
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, isRead: true })),
      );
      await fetchUnreadCount();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al marcar todas como leídas');
      throw err;
    }
  }, [tenantId, fetchUnreadCount]);

  const deleteNotification = useCallback(async (id: string) => {
    if (!tenantId) return;
    try {
      await api.deleteNotification(tenantId, id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      setTotal((prev) => prev - 1);
      await fetchUnreadCount();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar notificación');
      throw err;
    }
  }, [tenantId, fetchUnreadCount]);

  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

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
