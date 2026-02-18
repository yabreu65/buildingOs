'use client';

import { useState, useCallback, useEffect } from 'react';
import * as api from './notifications.api';
import type { Notification } from './notifications.api';

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch notifications with optional filters
   */
  const fetch = useCallback(
    async (params?: { isRead?: boolean; type?: string; skip?: number; take?: number }) => {
      setLoading(true);
      setError(null);

      try {
        const result = await api.listNotifications(params);
        setNotifications(result.notifications);
        setTotal(result.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch notifications');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  /**
   * Fetch unread count
   */
  const fetchUnreadCount = useCallback(async () => {
    try {
      const count = await api.getUnreadCount();
      setUnreadCount(count);
    } catch (err) {
      console.error('Failed to fetch unread count:', err);
    }
  }, []);

  /**
   * Mark single notification as read
   */
  const markAsRead = useCallback(async (id: string) => {
    try {
      const updated = await api.markAsRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? updated : n)),
      );
      await fetchUnreadCount();
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark as read');
      throw err;
    }
  }, [fetchUnreadCount]);

  /**
   * Mark all notifications as read
   */
  const markAllAsRead = useCallback(async () => {
    try {
      const result = await api.markAllAsRead();
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, isRead: true })),
      );
      await fetchUnreadCount();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark all as read');
      throw err;
    }
  }, [fetchUnreadCount]);

  /**
   * Delete notification
   */
  const deleteNotification = useCallback(async (id: string) => {
    try {
      await api.deleteNotification(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      setTotal((prev) => prev - 1);
      await fetchUnreadCount();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete notification');
      throw err;
    }
  }, [fetchUnreadCount]);

  // Fetch unread count on mount
  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  return {
    notifications,
    total,
    unreadCount,
    loading,
    error,
    fetch,
    fetchUnreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  };
}
