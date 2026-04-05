import { NotificationType, DeliveryMethod } from '@prisma/client';

export interface CreateNotificationInput {
  tenantId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, any>;
  deliveryMethods?: DeliveryMethod[];
}

/**
 * Configuration for which notification types trigger email delivery
 */
export interface NotificationConfig {
  // Notification types that should send emails
  emailTriggers: Set<NotificationType>;

  // Email templates for different notification types
  emailTemplates: Record<
    NotificationType,
    {
      subject: string;
      bodyTemplate: string; // Can use {{variables}} for substitution
    }
  >;
}

/**
 * Default notification configuration
 * Emails sent for critical events only
 */
export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  emailTriggers: new Set([
    'SUPPORT_TICKET_STATUS_CHANGED',
    'CHARGE_PUBLISHED',
    'PAYMENT_RECEIVED',
    'PAYMENT_REJECTED',
    'PAYMENT_OVERDUE',
    'PAYMENT_REMINDER',
    'USER_INVITED',
    'TICKET_STATUS_CHANGED',
    'URGENT_TICKET_UNASSIGNED',
  ]),

  emailTemplates: {
    TICKET_STATUS_CHANGED: {
      subject: 'Your ticket status has been updated',
      bodyTemplate: 'Ticket "{{title}}" is now {{status}}',
    },
    TICKET_COMMENT_ADDED: {
      subject: 'New comment on your ticket',
      bodyTemplate: 'Someone commented on "{{title}}": {{comment}}',
    },
    SUPPORT_TICKET_CREATED: {
      subject: 'Support request received',
      bodyTemplate: 'We received your support request: {{title}}',
    },
    SUPPORT_TICKET_STATUS_CHANGED: {
      subject: 'Support request status updated',
      bodyTemplate: 'Your support request "{{title}}" is now {{status}}',
    },
    USER_INVITED: {
      subject: 'You have been invited to BuildingOS',
      bodyTemplate: 'You have been invited to join {{tenantName}}. Click here to accept.',
    },
    INVITATION_ACCEPTED: {
      subject: 'Invitation accepted',
      bodyTemplate: '{{userName}} has accepted your invitation.',
    },
    CHARGE_PUBLISHED: {
      subject: '{{buildingName}} - New charge for {{period}}',
      bodyTemplate: 'A new charge has been registered in your unit {{unitLabel}}: {{amount}} {{currency}}. Due date: {{dueDate}}',
    },
    PAYMENT_RECEIVED: {
      subject: 'Payment received',
      bodyTemplate: 'Your payment of {{amount}} {{currency}} has been received and approved.',
    },
    PAYMENT_REJECTED: {
      subject: 'Payment rejected',
      bodyTemplate: 'Your payment of {{amount}} {{currency}} has been rejected. Reason: {{rejectionReason}}',
    },
    PAYMENT_OVERDUE: {
      subject: 'Payment is overdue',
      bodyTemplate: 'Your payment of {{amount}} is now overdue. Please pay immediately.',
    },
    PAYMENT_REMINDER: {
      subject: 'Pago vence en 3 días',
      bodyTemplate: 'Recordatorio: Tu pago de {{amount}} {{currency}} para {{unitLabel}} vence el {{dueDate}}. Realiza el pago ahora para evitar demoras.',
    },
    EXPENSE_PERIOD_CREATED: {
      subject: 'Nuevo período de gastos - {{buildingName}}',
      bodyTemplate: 'Se ha creado automáticamente el período {{period}} para {{buildingName}}. Monto sugerido: {{suggestedTotal}}. Revisa y ajusta en BuildingOS.',
    },
    DOCUMENT_SHARED: {
      subject: 'Document shared with you',
      bodyTemplate: '"{{documentName}}" has been shared with you.',
    },
    BUILDING_ALERT: {
      subject: 'Building alert',
      bodyTemplate: '{{alert}}',
    },
    OCCUPANT_ASSIGNED: {
      subject: 'You have been assigned to a unit',
      bodyTemplate: 'You have been assigned to unit {{unitName}} in {{buildingName}}.',
    },
    URGENT_TICKET_UNASSIGNED: {
      subject: '🚨 Ticket URGENTE sin asignar en {{buildingName}}',
      bodyTemplate: 'El ticket "{{ticketTitle}}" está ABIERTO y SIN ASIGNAR desde hace {{hoursWaiting}} horas. Prioridad: {{ticketPriority}}. Reportado por: {{createdBy}}',
    },
    SYSTEM_ALERT: {
      subject: 'System alert',
      bodyTemplate: '{{message}}',
    },
  },
};
