import type { Notification } from '@/features/notifications/notifications.api';

type FrontendNotificationType = Notification['type'];

/**
 * Ticket-related notification types.
 * Used for icon classification and navigation routing.
 */
export const TICKET_NOTIFICATION_TYPES: readonly FrontendNotificationType[] = [
  'TICKET_STATUS_CHANGED',
  'TICKET_COMMENT_ADDED',
  'SUPPORT_TICKET_CREATED',
  'SUPPORT_TICKET_STATUS_CHANGED',
  'URGENT_TICKET_UNASSIGNED',
] as const;

/**
 * Payment and charge notification types.
 */
export const PAYMENT_NOTIFICATION_TYPES: readonly FrontendNotificationType[] = [
  'PAYMENT_RECEIVED',
  'PAYMENT_REJECTED',
  'PAYMENT_REMINDER',
  'PAYMENT_OVERDUE',
  'CHARGE_PUBLISHED',
] as const;

/**
 * Document notification types.
 */
export const DOCUMENT_NOTIFICATION_TYPES: readonly FrontendNotificationType[] = [
  'DOCUMENT_SHARED',
] as const;

/**
 * Unit assignment notification types.
 */
export const UNIT_NOTIFICATION_TYPES: readonly FrontendNotificationType[] = [
  'OCCUPANT_ASSIGNED',
] as const;

/**
 * Returns the category of a notification type for icon and navigation classification.
 */
export function getNotificationCategory(type: FrontendNotificationType):
  | 'ticket'
  | 'payment'
  | 'document'
  | 'unit'
  | 'other' {
  if ((TICKET_NOTIFICATION_TYPES as readonly string[]).includes(type)) return 'ticket';
  if ((PAYMENT_NOTIFICATION_TYPES as readonly string[]).includes(type)) return 'payment';
  if ((DOCUMENT_NOTIFICATION_TYPES as readonly string[]).includes(type)) return 'document';
  if ((UNIT_NOTIFICATION_TYPES as readonly string[]).includes(type)) return 'unit';
  return 'other';
}
