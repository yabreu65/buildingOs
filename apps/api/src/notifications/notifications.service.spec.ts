import { DeliveryMethod, NotificationType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { EmailType } from '../email/email.types';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService email delivery', () => {
  const tenantId = 'tenant-123';
  const userId = 'user-123';
  const userEmail = 'resident@example.com';

  let service: NotificationsService;
  let prismaService: {
    notification: { create: jest.Mock };
    membership: { findFirst: jest.Mock };
  };
  let auditService: { createLog: jest.Mock };
  let emailService: { sendEmail: jest.Mock };

  beforeEach(() => {
    prismaService = {
      notification: {
        create: jest.fn().mockResolvedValue({ id: 'notification-123' }),
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

  const createPaymentNotification = (type: NotificationType): Promise<void> =>
    service.createNotification({
      tenantId,
      userId,
      type,
      title: 'Payment notification',
      body: 'A payment event occurred.',
      data: {
        amount: '$120.00',
        currency: 'USD',
        buildingName: 'Main Tower',
        unitLabel: 'A-101',
        period: '2026-07',
        dueDate: '2026-07-31',
        rejectionReason: 'Unreadable receipt',
      },
      deliveryMethods: ['IN_APP', 'EMAIL'] as DeliveryMethod[],
    });

  it.each<NotificationType>([
    'CHARGE_PUBLISHED',
    'PAYMENT_RECEIVED',
    'PAYMENT_REJECTED',
    'PAYMENT_OVERDUE',
    'PAYMENT_REMINDER',
  ])('sends email for configured payment notification type %s', async (type) => {
    await createPaymentNotification(type);

    expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: userEmail,
        tenantId,
      }),
      EmailType.PAYMENT_SUBMITTED,
    );
  });

  it('renders configured payment template variables before sending email', async () => {
    await createPaymentNotification('PAYMENT_REJECTED');

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Payment rejected',
        textBody: 'Your payment of $120.00 USD has been rejected. Reason: Unreadable receipt',
        htmlBody: expect.stringContaining('Unreadable receipt'),
      }),
      EmailType.PAYMENT_SUBMITTED,
    );
  });

  it('does not send email when EMAIL delivery is not requested', async () => {
    await service.createNotification({
      tenantId,
      userId,
      type: 'PAYMENT_RECEIVED',
      title: 'Payment received',
      body: 'Payment was received.',
      deliveryMethods: ['IN_APP'],
    });

    expect(prismaService.membership.findFirst).not.toHaveBeenCalled();
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  it('does not send email when notification type is not configured for email', async () => {
    await service.createNotification({
      tenantId,
      userId,
      type: 'DOCUMENT_SHARED',
      title: 'Document shared',
      body: 'A document was shared.',
      deliveryMethods: ['EMAIL'],
    });

    expect(prismaService.membership.findFirst).not.toHaveBeenCalled();
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  it('does not send email when recipient email is missing', async () => {
    prismaService.membership.findFirst.mockResolvedValue({ user: { email: null } });

    await createPaymentNotification('PAYMENT_RECEIVED');

    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });
});
