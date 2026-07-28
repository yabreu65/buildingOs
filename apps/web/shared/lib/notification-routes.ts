import {
  ticketDetailPath,
  residentTicketDetailPath,
  residentTicketsPath,
  buildingTickets,
} from './routes';
import {
  TICKET_NOTIFICATION_TYPES,
  SUPPORT_TICKET_NOTIFICATION_TYPES,
  PAYMENT_NOTIFICATION_TYPES,
  DOCUMENT_NOTIFICATION_TYPES,
  UNIT_NOTIFICATION_TYPES,
} from './notification-types';
import type { Notification } from '@/features/notifications/notifications.api';

export interface NotificationRoleContext {
  readonly isAdmin: boolean;
  readonly isResident: boolean;
  readonly portalContext?: 'resident' | 'admin';
}

const ADMIN_PATH_SEGMENTS = [
  '/finanzas',
  '/finance',
  '/buildings',
  '/super-admin',
  '/admin',
  '/settings',
  '/reports',
  '/communications',
  '/support',
];

function hasProtocol(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

function decodeSafe(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function hasTraversalOrSlash(value: string): boolean {
  return value.includes('..') || value.includes('\\');
}

function hasDoubleSlash(value: string): boolean {
  return value.startsWith('//');
}

function isAdminPath(path: string, tenantId: string): boolean {
  return ADMIN_PATH_SEGMENTS.some((seg) =>
    path.startsWith(`/${tenantId}${seg}`)
  );
}

function isSafeResidentPath(path: string, tenantId: string): boolean {
  if (!path.startsWith(`/${tenantId}/resident/`)) return false;

  const decoded = decodeSafe(path);
  if (decoded === null) return false;
  if (hasProtocol(decoded)) return false;
  if (hasDoubleSlash(decoded)) return false;
  if (hasTraversalOrSlash(decoded)) return false;

  return true;
}

function isSafeAdminPath(path: string, tenantId: string): boolean {
  if (!path.startsWith(`/${tenantId}/`)) return false;
  if (path.startsWith(`/${tenantId}/resident/`)) return false;
  if (isAdminPath(path, tenantId)) return false;

  const decoded = decodeSafe(path);
  if (decoded === null) return false;
  if (hasProtocol(decoded)) return false;
  if (hasDoubleSlash(decoded)) return false;
  if (hasTraversalOrSlash(decoded)) return false;

  return true;
}

function isTicketType(type: string): boolean {
  return (TICKET_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

function isSupportTicketType(type: string): boolean {
  return (SUPPORT_TICKET_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

function isPaymentType(type: string): boolean {
  return (PAYMENT_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

function isResidentContext(ctx: NotificationRoleContext): boolean {
  return ctx.portalContext === 'resident' || (!ctx.portalContext && ctx.isResident && !ctx.isAdmin);
}

function isAdminContext(ctx: NotificationRoleContext): boolean {
  return ctx.portalContext === 'admin' || (!ctx.portalContext && ctx.isAdmin);
}

function hasTicketId(data: Notification['data']): data is Notification['data'] & { ticketId: string } {
  return typeof data?.ticketId === 'string' && data.ticketId.length > 0;
}

export function resolveNotificationPath(
  notification: Notification,
  tenantId: string,
  roleContext: NotificationRoleContext,
): string | null {
  const { type, data } = notification;
  const ticketId = data?.ticketId;

  // 1. Building ticket creation notifications with a ticketId route to the canonical ticket detail
  if (type === 'SUPPORT_TICKET_CREATED' && hasTicketId(data)) {
    return isResidentContext(roleContext)
      ? residentTicketDetailPath(tenantId, data.ticketId)
      : ticketDetailPath(tenantId, data.ticketId);
  }

  // 2. Support ticket status updates keep their historical support route
  if (isSupportTicketType(type)) {
    return `/${tenantId}/support`;
  }

  // 3. Building ticket types: first confirm type, then use ticketId if available
  if (isTicketType(type)) {
    if (ticketId && typeof ticketId === 'string') {
      return isResidentContext(roleContext)
        ? residentTicketDetailPath(tenantId, ticketId)
        : ticketDetailPath(tenantId, ticketId);
    }
    if (isAdminContext(roleContext)) {
      const buildingId = data?.buildingId;
      return buildingId
        ? buildingTickets(tenantId, buildingId)
        : `/${tenantId}/tickets`;
    }
    if (isResidentContext(roleContext)) {
      return residentTicketsPath(tenantId);
    }
    return `/${tenantId}/tickets`;
  }

  // 4. Resident payment submissions from building alerts behave like payments
  if (type === 'BUILDING_ALERT' && data?.event === 'PAYMENT_SUBMITTED') {
    return isAdminContext(roleContext)
      ? `/${tenantId}/finanzas?tab=payments`
      : `/${tenantId}/resident/payments`;
  }

  // 5. Payment types
  if (isPaymentType(type)) {
    return isAdminContext(roleContext)
      ? `/${tenantId}/finanzas?tab=payments`
      : `/${tenantId}/resident/payments`;
  }

  // 6. Document types
  if ((DOCUMENT_NOTIFICATION_TYPES as readonly string[]).includes(type)) {
    if (isAdminContext(roleContext)) {
      const buildingId = data?.buildingId;
      return buildingId
        ? `/${tenantId}/buildings/${buildingId}/documents`
        : `/${tenantId}/buildings`;
    }
    return `/${tenantId}/resident/documents`;
  }

  // 7. Unit types
  if ((UNIT_NOTIFICATION_TYPES as readonly string[]).includes(type)) {
    if (isAdminContext(roleContext)) {
      const buildingId = data?.buildingId;
      return buildingId
        ? `/${tenantId}/buildings/${buildingId}/units`
        : `/${tenantId}/buildings`;
    }
    return `/${tenantId}/resident/unit`;
  }

  // 8. Fallback URL — strict validation only for known types
  const fallbackUrl = data?.url;
  if (typeof fallbackUrl !== 'string' || !fallbackUrl.startsWith('/')) {
    return null;
  }

  if (isResidentContext(roleContext) && isSafeResidentPath(fallbackUrl, tenantId)) {
    return fallbackUrl;
  }

  if (isAdminContext(roleContext) && isSafeAdminPath(fallbackUrl, tenantId)) {
    return fallbackUrl;
  }

  return null;
}
