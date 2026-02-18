import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { Notification, DeliveryMethod, NotificationType } from '@prisma/client';
import { EmailType } from '../email/email.types';
import { CreateNotificationInput, DEFAULT_NOTIFICATION_CONFIG } from './notifications.types';

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private emailService: EmailService,
    private configService: ConfigService,
  ) {}

  /**
   * Create notification (fire-and-forget pattern)
   *
   * RULE: This method must NEVER throw or fail the calling operation.
   * If anything fails, log to console and continue.
   *
   * @param input Notification input
   */
  async createNotification(input: CreateNotificationInput): Promise<void> {
    try {
      // Determine delivery methods
      const deliveryMethods = input.deliveryMethods ?? ['IN_APP'];

      // Create notification in database
      const notification = await this.prisma.notification.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          data: input.data ?? {},
          deliveryMethods,
        },
      });

      // Audit log (also fire-and-forget)
      await this.auditService.createLog({
        tenantId: input.tenantId,
        action: 'NOTIFICATION_CREATED',
        entityType: 'Notification',
        entityId: notification.id,
        actorUserId: null, // System action, no actor
        metadata: { type: input.type },
      });

      // Send email if configured and requested
      if (deliveryMethods.includes('EMAIL')) {
        await this.sendEmailIfConfigured(input);
      }
    } catch (err) {
      // RULE: Never fail main operation on notification failure
      const message = err instanceof Error ? err.message : String(err);
      console.error('[NotificationsService] Failed to create notification:', {
        message,
        input,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(
    notificationId: string,
    tenantId: string,
    userId: string,
  ): Promise<Notification> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    // Verify ownership
    if (notification.userId !== userId || notification.tenantId !== tenantId) {
      throw new NotFoundException('Notification not found');
    }

    // Update
    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    // Audit log
    await this.auditService.createLog({
      tenantId,
      action: 'NOTIFICATION_READ',
      entityType: 'Notification',
      entityId: notificationId,
      actorUserId: userId,
    });

    return updated;
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(
    tenantId: string,
    userId: string,
  ): Promise<{ count: number }> {
    const result = await this.prisma.notification.updateMany({
      where: {
        tenantId,
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return { count: result.count };
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(tenantId: string, userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        tenantId,
        userId,
        isRead: false,
      },
    });
  }

  /**
   * Query notifications with filters
   */
  async queryNotifications(
    tenantId: string,
    userId: string,
    filters?: { isRead?: boolean; type?: NotificationType },
    skip: number = 0,
    take: number = 50,
  ): Promise<{ notifications: Notification[]; total: number }> {
    const where: any = {
      tenantId,
      userId,
    };

    // Apply filters
    if (filters?.isRead !== undefined) {
      where.isRead = filters.isRead;
    }
    if (filters?.type) {
      where.type = filters.type;
    }

    // Get notifications and total count in parallel
    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: Math.min(take, 100),
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { notifications, total };
  }

  /**
   * Delete notification
   */
  async deleteNotification(
    notificationId: string,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    // Verify ownership
    if (notification.userId !== userId || notification.tenantId !== tenantId) {
      throw new NotFoundException('Notification not found');
    }

    // Soft delete
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { deletedAt: new Date() },
    });

    // Audit log
    await this.auditService.createLog({
      tenantId,
      action: 'NOTIFICATION_DELETED',
      entityType: 'Notification',
      entityId: notificationId,
      actorUserId: userId,
    });
  }

  /**
   * Private: Send email if notification type is configured for email
   */
  private async sendEmailIfConfigured(input: CreateNotificationInput): Promise<void> {
    try {
      const config = DEFAULT_NOTIFICATION_CONFIG;

      // Check if this notification type should trigger an email
      if (!config.emailTriggers.has(input.type)) {
        return; // No email needed for this type
      }

      // Get user email
      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
      });

      if (!user || !user.email) {
        return; // No email address
      }

      // Get template
      const template = config.emailTemplates[input.type];
      if (!template) {
        return; // No template defined
      }

      // Substitute variables in subject and body
      const subject = this.substituteVariables(template.subject, input.data);
      const body = this.substituteVariables(template.bodyTemplate, input.data);

      // Send email (fire-and-forget, EmailService handles failures)
      // Use PAYMENT_SUBMITTED as a generic notification type (we can extend this later)
      await this.emailService.sendEmail(
        {
          to: user.email,
          subject,
          htmlBody: this.wrapHtmlBody(body, input.title),
          textBody: body,
          tenantId: input.tenantId,
        },
        EmailType.PAYMENT_SUBMITTED, // Generic notification type for now
      );
    } catch (err) {
      // RULE: Never fail main operation
      console.error('[NotificationsService] Failed to send email:', {
        error: err instanceof Error ? err.message : String(err),
        type: input.type,
      });
    }
  }

  /**
   * Private: Substitute {{variable}} placeholders with data
   */
  private substituteVariables(template: string, data?: Record<string, any>): string {
    if (!data) {
      return template;
    }

    let result = template;
    Object.entries(data).forEach(([key, value]) => {
      const placeholder = `{{${key}}}`;
      result = result.replace(new RegExp(placeholder, 'g'), String(value));
    });
    return result;
  }

  /**
   * Private: Wrap text body in HTML
   */
  private wrapHtmlBody(body: string, title: string): string {
    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333;">
        <h2 style="color: #1E3A8A; margin-bottom: 16px;">${title}</h2>
        <p>${body}</p>
        <p style="margin-top: 24px; color: #666; font-size: 12px;">
          This is an automated notification from BuildingOS. You can manage your notification preferences in your account settings.
        </p>
      </div>
    `;
  }
}
