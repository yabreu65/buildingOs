import type { Notification } from '@/features/notifications/notifications.api';

type FrontendNotificationType = Notification['type'];

/**
 * Building ticket notification types (module: /tickets).
 * These use ticketDetailPath or buildingTickets routing.
 */
export const TICKET_NOTIFICATION_TYPES: readonly FrontendNotificationType[] = [
  'TICKET_STATUS_CHANGED',
  'TICKET_COMMENT_ADDED',
  'URGENT_TICKET_UNASSIGNED',
] as const;

/**
 * Support ticket notification types (module: /support).
 * These route to the support page, not building tickets.
 */
export const SUPPORT_TICKET_NOTIFICATION_TYPES: readonly FrontendNotificationType[] = [
  'SUPPORT_TICKET_CREATED',
  'SUPPORT_TICKET_STATUS_CHANGED',
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
  | 'support'
  | 'payment'
  | 'document'
  | 'unit'
  | 'other' {
  if ((TICKET_NOTIFICATION_TYPES as readonly string[]).includes(type)) return 'ticket';
  if ((SUPPORT_TICKET_NOTIFICATION_TYPES as readonly string[]).includes(type)) return 'support';
  if ((PAYMENT_NOTIFICATION_TYPES as readonly string[]).includes(type)) return 'payment';
  if ((DOCUMENT_NOTIFICATION_TYPES as readonly string[]).includes(type)) return 'document';
  if ((UNIT_NOTIFICATION_TYPES as readonly string[]).includes(type)) return 'unit';
  return 'other';
}
