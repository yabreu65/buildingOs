'use client';

import { apiClient } from '@/shared/lib/http/client';

export interface Notification {
  id: string;
  tenantId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  deliveryMethods: string[];
  isRead: boolean;
  readAt?: string | null;
  createdAt: string;
  deletedAt?: string | null;
}

/**
 * List user's notifications
 */
export async function listNotifications(params?: {
  isRead?: boolean;
  type?: string;
  skip?: number;
  take?: number;
}): Promise<{ notifications: Notification[]; total: number }> {
  const query = new URLSearchParams();

  if (params?.isRead !== undefined) query.append('isRead', String(params.isRead));
  if (params?.type) query.append('type', params.type);
  if (params?.skip) query.append('skip', String(params.skip));
  if (params?.take) query.append('take', String(params.take));

  return apiClient({
    path: `/me/notifications?${query}`,
    method: 'GET',
  });
}

/**
 * Get unread notification count
 */
export async function getUnreadCount(): Promise<number> {
  const data = await apiClient<{ unreadCount: number }>({
    path: '/me/notifications/unread-count',
    method: 'GET',
  });
  return data.unreadCount;
}

/**
 * Mark notification as read
 */
export async function markAsRead(id: string): Promise<Notification> {
  return apiClient<Notification>({
    path: `/me/notifications/${id}/read`,
    method: 'PATCH',
  });
}

/**
 * Mark all notifications as read
 */
export async function markAllAsRead(): Promise<{ count: number }> {
  return apiClient<{ count: number }>({
    path: '/me/notifications/read-all',
    method: 'PATCH',
  });
}

/**
 * Delete notification
 */
export async function deleteNotification(id: string): Promise<void> {
  await apiClient<void>({
    path: `/me/notifications/${id}`,
    method: 'DELETE',
  });
}
