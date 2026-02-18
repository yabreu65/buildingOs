'use client';

import { getToken } from '@/features/auth/session.storage';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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
  const token = getToken();
  const query = new URLSearchParams();

  if (params?.isRead !== undefined) query.append('isRead', String(params.isRead));
  if (params?.type) query.append('type', params.type);
  if (params?.skip) query.append('skip', String(params.skip));
  if (params?.take) query.append('take', String(params.take));

  const response = await fetch(`${API_URL}/me/notifications?${query}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch notifications: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get unread notification count
 */
export async function getUnreadCount(): Promise<number> {
  const token = getToken();

  const response = await fetch(`${API_URL}/me/notifications/unread-count`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch unread count: ${response.statusText}`);
  }

  const data = await response.json();
  return data.unreadCount;
}

/**
 * Mark notification as read
 */
export async function markAsRead(id: string): Promise<Notification> {
  const token = getToken();

  const response = await fetch(`${API_URL}/me/notifications/${id}/read`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to mark notification as read: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Mark all notifications as read
 */
export async function markAllAsRead(): Promise<{ count: number }> {
  const token = getToken();

  const response = await fetch(`${API_URL}/me/notifications/read-all`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to mark all as read: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Delete notification
 */
export async function deleteNotification(id: string): Promise<void> {
  const token = getToken();

  const response = await fetch(`${API_URL}/me/notifications/${id}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to delete notification: ${response.statusText}`);
  }
}
