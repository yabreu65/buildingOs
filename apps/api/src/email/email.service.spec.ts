import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';
import { EmailType } from './email.types';

describe('EmailService', () => {
  it('reports skipped success and does not write an email log when provider is none', async () => {
    const configService = {
      getValue: jest.fn().mockReturnValue('none'),
      get: jest.fn().mockReturnValue({ mailProvider: 'none' }),
    };
    const prismaService = {
      emailLog: {
        create: jest.fn(),
      },
    };
    const service = new EmailService(
      configService as unknown as ConfigService,
      prismaService as unknown as PrismaService,
    );

    const result = await service.sendEmail(
      {
        to: 'resident@example.com',
        subject: 'Payment received',
        htmlBody: '<p>Payment received</p>',
        tenantId: 'tenant-123',
      },
      EmailType.PAYMENT_SUBMITTED,
    );

    expect(result).toEqual({ success: true, skipped: true });
    expect(prismaService.emailLog.create).not.toHaveBeenCalled();
  });
});
