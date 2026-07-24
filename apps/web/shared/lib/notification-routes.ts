import { buildingTickets, residentTicketsPath, ticketDetailPath } from './routes';
import type { Notification } from '@/features/notifications/notifications.api';

export interface NotificationRoleContext {
  readonly isAdmin: boolean;
  readonly isResident: boolean;
}

function isInternalPath(path: string | undefined): path is string {
  return Boolean(path && path.startsWith('/'));
}

export function resolveNotificationPath(
  notification: Notification,
  tenantId: string,
  roleContext: NotificationRoleContext,
): string | null {
  const ticketId = notification.data?.ticketId;
  if (ticketId) {
    return ticketDetailPath(tenantId, ticketId);
  }

  const ticketRelatedTypes = new Set([
    'TICKET_STATUS_CHANGED',
    'TICKET_COMMENT_ADDED',
    'TICKET_CREATED',
    'TICKET_ASSIGNED',
    'URGENT_TICKET_UNASSIGNED',
  ]);

  if (ticketRelatedTypes.has(notification.type)) {
    if (roleContext.isAdmin) {
      const buildingId = notification.data?.buildingId;
      return buildingId ? buildingTickets(tenantId, buildingId) : `/${tenantId}/tickets`;
    }

    if (roleContext.isResident) {
      return residentTicketsPath(tenantId);
    }

    return `/${tenantId}/tickets`;
  }

  if (notification.type === 'PAYMENT_RECEIVED' || notification.type === 'PAYMENT_REJECTED') {
    return roleContext.isAdmin
      ? `/${tenantId}/finanzas?tab=payments`
      : `/${tenantId}/resident/payments`;
  }

  const fallbackUrl = notification.data?.url;
  if (isInternalPath(fallbackUrl)) {
    return fallbackUrl;
  }

  return null;
}
