'use client';

import { apiClient } from '@/shared/lib/http/client';

export interface NotificationData {
  event?: string;
  paymentId?: string;
  paymentAmount?: number;
  paymentCurrency?: string;
  ticketId?: string;
  buildingId?: string;
  tenantId?: string;
  unitId?: string;
  url?: string;
}

export interface Notification {
  id: string;
  tenantId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: NotificationData;
  deliveryMethods: string[];
  isRead: boolean;
  readAt?: string | null;
  createdAt: string;
  deletedAt?: string | null;
}

export interface ListNotificationsParams {
  isRead?: boolean;
  type?: string;
  skip?: number;
  take?: number;
}

function basePath(tenantId: string): string {
  return `/tenants/${encodeURIComponent(tenantId)}/notifications`;
}

export async function listNotifications(
  tenantId: string,
  params?: ListNotificationsParams,
): Promise<{ notifications: Notification[]; total: number }> {
  const query = new URLSearchParams();

  if (params?.isRead !== undefined) query.append('isRead', String(params.isRead));
  if (params?.type) query.append('type', params.type);
  if (params?.skip !== undefined && params.skip > 0) query.append('skip', String(params.skip));
  if (params?.take !== undefined) query.append('take', String(params.take));

  const qs = query.toString();
  const path = qs ? `${basePath(tenantId)}?${qs}` : basePath(tenantId);

  return apiClient({
    path,
    method: 'GET',
  });
}

export async function getUnreadCount(tenantId: string): Promise<number> {
  const data = await apiClient<{ unreadCount: number }>({
    path: `${basePath(tenantId)}/unread-count`,
    method: 'GET',
  });
  return data.unreadCount;
}

export async function markAsRead(
  tenantId: string,
  notificationId: string,
): Promise<Notification> {
  return apiClient<Notification>({
    path: `${basePath(tenantId)}/${encodeURIComponent(notificationId)}/read`,
    method: 'PATCH',
  });
}

export async function markAllAsRead(
  tenantId: string,
): Promise<{ success: boolean }> {
  return apiClient<{ success: boolean }>({
    path: `${basePath(tenantId)}/read-all`,
    method: 'PATCH',
  });
}

export async function deleteNotification(
  tenantId: string,
  notificationId: string,
): Promise<void> {
  await apiClient<void>({
    path: `${basePath(tenantId)}/${encodeURIComponent(notificationId)}`,
    method: 'DELETE',
  });
}
