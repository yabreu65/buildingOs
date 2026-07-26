import { DeliveryMethod, NotificationType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { EmailType } from '../email/email.types';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const tenantId = 'tenant-123';
  const userId = 'user-123';
  const otherTenantId = 'tenant-999';
  const otherUserId = 'user-999';
  const userEmail = 'resident@example.com';

  let service: NotificationsService;
  let prismaService: {
    notification: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
    membership: { findFirst: jest.Mock };
  };
  let auditService: { createLog: jest.Mock };
  let emailService: { sendEmail: jest.Mock };

  beforeEach(() => {
    prismaService = {
      notification: {
        create: jest.fn().mockResolvedValue({ id: 'notification-123' }),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
      membership: {
        findFirst: jest.fn().mockResolvedValue({ user: { email: userEmail } }),
      },
    };
    auditService = {
      createLog: jest.fn().mockResolvedValue(undefined),
    };
    emailService = {
      sendEmail: jest.fn().mockResolvedValue({ success: true }),
    };

    service = new NotificationsService(
      prismaService as unknown as PrismaService,
      auditService as unknown as AuditService,
      emailService as unknown as EmailService,
    );
  });

  describe('createNotification', () => {
    it('persists notification with correct fields', async () => {
      await service.createNotification({
        tenantId,
        userId,
        type: 'PAYMENT_RECEIVED',
        title: 'Payment received',
        body: 'Body',
        data: { amount: 100 },
        deliveryMethods: ['IN_APP'],
      });

      expect(prismaService.notification.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          userId,
          type: 'PAYMENT_RECEIVED',
          title: 'Payment received',
          body: 'Body',
          data: { amount: 100 },
          deliveryMethods: ['IN_APP'],
        },
      });
    });

    it('does not throw on failure (fire-and-forget)', async () => {
      prismaService.notification.create.mockRejectedValue(new Error('DB error'));

      await expect(
        service.createNotification({
          tenantId,
          userId,
          type: 'PAYMENT_RECEIVED',
          title: 'Title',
          body: 'Body',
        })
      ).resolves.toBeUndefined();

      expect(auditService.createLog).not.toHaveBeenCalled();
    });

    it('creates audit log after persistence', async () => {
      prismaService.notification.create.mockResolvedValue({ id: 'n-1' });

      await service.createNotification({
        tenantId,
        userId,
        type: 'TICKET_STATUS_CHANGED',
        title: 'Title',
        body: 'Body',
      });

      expect(auditService.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          action: 'NOTIFICATION_CREATED',
          entityType: 'Notification',
          entityId: 'n-1',
        })
      );
    });

    it('sends email when EMAIL delivery is requested and type is configured', async () => {
      await service.createNotification({
        tenantId,
        userId,
        type: 'PAYMENT_RECEIVED',
        title: 'Payment',
        body: 'Body',
        deliveryMethods: ['EMAIL'],
      });

      expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('does not send email when EMAIL delivery is not requested', async () => {
      await service.createNotification({
        tenantId,
        userId,
        type: 'PAYMENT_RECEIVED',
        title: 'Payment',
        body: 'Body',
        deliveryMethods: ['IN_APP'],
      });

      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });

    it('does not send email when notification type is not configured for email', async () => {
      await service.createNotification({
        tenantId,
        userId,
        type: 'DOCUMENT_SHARED',
        title: 'Doc',
        body: 'Body',
        deliveryMethods: ['EMAIL'],
      });

      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });

    it('does not send email when recipient email is missing', async () => {
      prismaService.membership.findFirst.mockResolvedValue({ user: { email: null } });

      await service.createNotification({
        tenantId,
        userId,
        type: 'PAYMENT_RECEIVED',
        title: 'Payment',
        body: 'Body',
        deliveryMethods: ['EMAIL'],
      });

      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('HTML escaping in emails', () => {
    it('escapes HTML entities in title and body', async () => {
      await service.createNotification({
        tenantId,
        userId,
        type: 'PAYMENT_RECEIVED',
        title: '<script>alert("xss")</script>',
        body: 'Body with <b>bold</b> and "quotes" and \'apostrophes\'',
        data: { amount: '$120.00', currency: 'USD' },
        deliveryMethods: ['EMAIL'],
      });

      const emailCall = emailService.sendEmail.mock.calls[0];
      const htmlBody = emailCall[0].htmlBody;

      expect(htmlBody).not.toContain('<script>');
      expect(htmlBody).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('converts newlines to br after escaping', async () => {
      await service.createNotification({
        tenantId,
        userId,
        type: 'PAYMENT_RECEIVED',
        title: 'Title\nSecond line',
        body: 'Body',
        data: { amount: '$120.00', currency: 'USD' },
        deliveryMethods: ['EMAIL'],
      });

      const emailCall = emailService.sendEmail.mock.calls[0];
      const htmlBody = emailCall[0].htmlBody;

      expect(htmlBody).toContain('Title<br>Second line');
    });

    it('escapes ampersand first to avoid double-escaping', async () => {
      await service.createNotification({
        tenantId,
        userId,
        type: 'PAYMENT_RECEIVED',
        title: 'A & B',
        body: 'Test',
        data: { amount: '$120.00', currency: 'USD' },
        deliveryMethods: ['EMAIL'],
      });

      const emailCall = emailService.sendEmail.mock.calls[0];
      const htmlBody = emailCall[0].htmlBody;

      expect(htmlBody).toContain('A &amp; B');
      expect(htmlBody).not.toContain('&amp;amp;');
    });
  });

  describe('markAsRead', () => {
    const notificationId = 'n-1';

    beforeEach(() => {
      prismaService.notification.findFirst.mockResolvedValue({
        id: notificationId,
        tenantId,
        userId,
        isRead: false,
      });
    });

    it('marks notification as read with correct tenant+user scope', async () => {
      prismaService.notification.updateMany.mockResolvedValue({ count: 1 });
      prismaService.notification.findFirst
        .mockResolvedValueOnce({
          id: notificationId,
          tenantId,
          userId,
          isRead: false,
        })
        .mockResolvedValueOnce({
          id: notificationId,
          tenantId,
          userId,
          isRead: true,
          readAt: new Date(),
        });

      const result = await service.markAsRead(notificationId, tenantId, userId);

      expect(prismaService.notification.updateMany).toHaveBeenCalledWith({
        where: { id: notificationId, tenantId, userId, deletedAt: null },
        data: { isRead: true, readAt: expect.any(Date) },
      });
      expect(result.isRead).toBe(true);
    });

    it('throws NotFoundException for other tenant', async () => {
      prismaService.notification.findFirst.mockResolvedValue(null);

      await expect(
        service.markAsRead(notificationId, otherTenantId, userId)
      ).rejects.toThrow('Notification not found');
    });

    it('throws NotFoundException for other user', async () => {
      prismaService.notification.findFirst.mockResolvedValue(null);

      await expect(
        service.markAsRead(notificationId, tenantId, otherUserId)
      ).rejects.toThrow('Notification not found');
    });

    it('throws NotFoundException when not found', async () => {
      prismaService.notification.findFirst.mockResolvedValue(null);

      await expect(
        service.markAsRead('nonexistent', tenantId, userId)
      ).rejects.toThrow('Notification not found');
    });

    it('creates audit log', async () => {
      prismaService.notification.updateMany.mockResolvedValue({ count: 1 });
      prismaService.notification.findFirst
        .mockResolvedValueOnce({
          id: notificationId,
          tenantId,
          userId,
          isRead: false,
        })
        .mockResolvedValueOnce({
          id: notificationId,
          tenantId,
          userId,
          isRead: true,
        });

      await service.markAsRead(notificationId, tenantId, userId);

      expect(auditService.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          action: 'NOTIFICATION_READ',
          entityId: notificationId,
          actorUserId: userId,
        })
      );
    });
  });

  describe('markAllAsRead', () => {
    it('returns count of updated notifications', async () => {
      prismaService.notification.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.markAllAsRead(tenantId, userId);

      expect(result.count).toBe(3);
      expect(prismaService.notification.updateMany).toHaveBeenCalledWith({
        where: { tenantId, userId, isRead: false, deletedAt: null },
        data: { isRead: true, readAt: expect.any(Date) },
      });
    });

    it('only updates unread notifications', async () => {
      prismaService.notification.updateMany.mockResolvedValue({ count: 0 });

      await service.markAllAsRead(tenantId, userId);

      expect(prismaService.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isRead: false }),
        })
      );
    });

    it('returns 0 when no notifications to mark', async () => {
      prismaService.notification.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.markAllAsRead(tenantId, userId);

      expect(result.count).toBe(0);
    });
  });

  describe('getUnreadCount', () => {
    it('returns correct count for tenant+user', async () => {
      prismaService.notification.count.mockResolvedValue(5);

      const result = await service.getUnreadCount(tenantId, userId);

      expect(result).toBe(5);
      expect(prismaService.notification.count).toHaveBeenCalledWith({
        where: { tenantId, userId, isRead: false, deletedAt: null },
      });
    });

    it('returns 0 when no unread notifications', async () => {
      prismaService.notification.count.mockResolvedValue(0);

      const result = await service.getUnreadCount(tenantId, userId);

      expect(result).toBe(0);
    });
  });

  describe('queryNotifications', () => {
    const mockNotifications = [
      { id: 'n-1', tenantId, userId, type: 'PAYMENT_RECEIVED', isRead: false, createdAt: new Date('2025-01-02') },
      { id: 'n-2', tenantId, userId, type: 'TICKET_STATUS_CHANGED', isRead: true, createdAt: new Date('2025-01-01') },
    ];

    it('returns notifications and total for tenant+user', async () => {
      prismaService.notification.findMany.mockResolvedValue(mockNotifications);
      prismaService.notification.count.mockResolvedValue(2);

      const result = await service.queryNotifications(tenantId, userId);

      expect(result.notifications).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(prismaService.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, userId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
        })
      );
    });

    it('applies isRead filter', async () => {
      prismaService.notification.findMany.mockResolvedValue([mockNotifications[0]]);
      prismaService.notification.count.mockResolvedValue(1);

      await service.queryNotifications(tenantId, userId, { isRead: false });

      expect(prismaService.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isRead: false }),
        })
      );
    });

    it('applies type filter', async () => {
      prismaService.notification.findMany.mockResolvedValue([]);
      prismaService.notification.count.mockResolvedValue(0);

      await service.queryNotifications(tenantId, userId, { type: 'PAYMENT_RECEIVED' });

      expect(prismaService.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: 'PAYMENT_RECEIVED' }),
        })
      );
    });

    it('applies skip and take', async () => {
      prismaService.notification.findMany.mockResolvedValue([]);
      prismaService.notification.count.mockResolvedValue(0);

      await service.queryNotifications(tenantId, userId, undefined, 10, 5);

      expect(prismaService.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 5,
        })
      );
    });

    it('caps take at 100', async () => {
      prismaService.notification.findMany.mockResolvedValue([]);
      prismaService.notification.count.mockResolvedValue(0);

      await service.queryNotifications(tenantId, userId, undefined, 0, 200);

      expect(prismaService.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
        })
      );
    });

    it('orders by createdAt desc', async () => {
      prismaService.notification.findMany.mockResolvedValue([]);
      prismaService.notification.count.mockResolvedValue(0);

      await service.queryNotifications(tenantId, userId);

      expect(prismaService.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        })
      );
    });
  });

  describe('deleteNotification', () => {
    const notificationId = 'n-del';

    it('soft deletes notification with correct scope', async () => {
      prismaService.notification.findFirst.mockResolvedValue({
        id: notificationId,
        tenantId,
        userId,
        deletedAt: null,
      });
      prismaService.notification.updateMany.mockResolvedValue({ count: 1 });

      await service.deleteNotification(notificationId, tenantId, userId);

      expect(prismaService.notification.updateMany).toHaveBeenCalledWith({
        where: { id: notificationId, tenantId, userId, deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('throws NotFoundException for other tenant', async () => {
      prismaService.notification.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteNotification(notificationId, otherTenantId, userId)
      ).rejects.toThrow('Notification not found');
    });

    it('throws NotFoundException for other user', async () => {
      prismaService.notification.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteNotification(notificationId, tenantId, otherUserId)
      ).rejects.toThrow('Notification not found');
    });

    it('throws NotFoundException for nonexistent notification', async () => {
      prismaService.notification.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteNotification('nonexistent', tenantId, userId)
      ).rejects.toThrow('Notification not found');
    });

    it('creates audit log', async () => {
      prismaService.notification.findFirst.mockResolvedValue({
        id: notificationId,
        tenantId,
        userId,
        deletedAt: null,
      });
      prismaService.notification.updateMany.mockResolvedValue({ count: 1 });

      await service.deleteNotification(notificationId, tenantId, userId);

      expect(auditService.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          action: 'NOTIFICATION_DELETED',
          entityId: notificationId,
          actorUserId: userId,
        })
      );
    });
  });
});
