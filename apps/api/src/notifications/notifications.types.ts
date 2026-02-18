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
    'PAYMENT_RECEIVED',
    'PAYMENT_OVERDUE',
    'USER_INVITED',
    'TICKET_STATUS_CHANGED',
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
    PAYMENT_RECEIVED: {
      subject: 'Payment received',
      bodyTemplate: 'Your payment of {{amount}} has been received.',
    },
    PAYMENT_OVERDUE: {
      subject: 'Payment is overdue',
      bodyTemplate: 'Your payment of {{amount}} is now overdue. Please pay immediately.',
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
    SYSTEM_ALERT: {
      subject: 'System alert',
      bodyTemplate: '{{message}}',
    },
  },
};
