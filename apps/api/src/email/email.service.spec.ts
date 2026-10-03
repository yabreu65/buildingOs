import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';
import { EmailType } from './email.types';
import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

const mockedCreateTransport = jest.mocked(nodemailer.createTransport);

describe('EmailService', () => {
  beforeEach(() => {
    mockedCreateTransport.mockReset();
  });

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

  it('does not invoke the provider when the live guard closes before send', async () => {
    const transporter = { sendMail: jest.fn() };
    mockedCreateTransport.mockReturnValue(transporter as unknown as nodemailer.Transporter);
    const emailLog = { create: jest.fn() };
    const service = new EmailService(
      {
        getValue: jest.fn().mockReturnValue('smtp'),
        get: jest.fn().mockReturnValue({ mailProvider: 'smtp', smtpHost: '127.0.0.1', smtpPort: 1025 }),
      } as unknown as ConfigService,
      { emailLog } as unknown as PrismaService,
    );

    const result = await service.sendEmail(
      { to: 'resident@example.com', subject: 'Subject', htmlBody: '<p>Body</p>', tenantId: 'tenant-1' },
      EmailType.PAYMENT_SUBMITTED,
      () => { throw new Error('indeterminate'); },
    );

    expect(result.success).toBe(false);
    expect(transporter.sendMail).not.toHaveBeenCalled();
    expect(emailLog.create).not.toHaveBeenCalled();
  });

  it('allows an in-flight provider send to finish but skips emailLog after closure', async () => {
    let finishSend: ((value: { messageId: string }) => void) | undefined;
    const transporter = {
      sendMail: jest.fn(() => new Promise<{ messageId: string }>((resolve) => { finishSend = resolve; })),
    };
    mockedCreateTransport.mockReturnValue(transporter as unknown as nodemailer.Transporter);
    const emailLog = { create: jest.fn() };
    const service = new EmailService(
      {
        getValue: jest.fn().mockReturnValue('smtp'),
        get: jest.fn().mockReturnValue({ mailProvider: 'smtp', smtpHost: '127.0.0.1', smtpPort: 1025 }),
      } as unknown as ConfigService,
      { emailLog } as unknown as PrismaService,
    );
    let open = true;

    const pending = service.sendEmail(
      { to: 'resident@example.com', subject: 'Subject', htmlBody: '<p>Body</p>', tenantId: 'tenant-1' },
      EmailType.PAYMENT_SUBMITTED,
      () => open,
    );
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    open = false;
    finishSend?.({ messageId: 'provider-1' });

    await expect(pending).resolves.toEqual({ success: true, externalId: 'provider-1' });
    expect(emailLog.create).not.toHaveBeenCalled();
  });

  it('does not persist a FAILED emailLog when an in-flight provider failure returns after closure', async () => {
    let rejectSend: ((error: Error) => void) | undefined;
    const transporter = {
      sendMail: jest.fn(() => new Promise<never>((_resolve, reject) => { rejectSend = reject; })),
    };
    mockedCreateTransport.mockReturnValue(transporter as unknown as nodemailer.Transporter);
    const emailLog = { create: jest.fn() };
    const service = new EmailService(
      {
        getValue: jest.fn().mockReturnValue('smtp'),
        get: jest.fn().mockReturnValue({ mailProvider: 'smtp', smtpHost: '127.0.0.1', smtpPort: 1025 }),
      } as unknown as ConfigService,
      { emailLog } as unknown as PrismaService,
    );
    let open = true;

    const pending = service.sendEmail(
      { to: 'resident@example.com', subject: 'Subject', htmlBody: '<p>Body</p>', tenantId: 'tenant-1' },
      EmailType.PAYMENT_SUBMITTED,
      () => open,
    );
    open = false;
    rejectSend?.(new Error('provider failure'));

    await expect(pending).resolves.toMatchObject({ success: false, error: 'provider failure' });
    expect(emailLog.create).not.toHaveBeenCalled();
  });

  it.each([
    { description: 'authenticated SMTP', smtpUser: 'mailer', smtpPass: 'secret', smtpPort: 587, secure: false, auth: { user: 'mailer', pass: 'secret' } },
    { description: 'unauthenticated SMTP', smtpUser: undefined, smtpPass: undefined, smtpPort: 1025, secure: false, auth: undefined },
    { description: 'blank local SMTP credentials', smtpUser: '', smtpPass: '', smtpPort: 1025, secure: false, auth: undefined },
    { description: 'SMTPS', smtpUser: 'mailer', smtpPass: 'secret', smtpPort: 465, secure: true, auth: { user: 'mailer', pass: 'secret' } },
  ])('configures $description without exposing credentials', async ({ smtpUser, smtpPass, smtpPort, secure, auth }) => {
    const transporter = { verify: jest.fn().mockResolvedValue(undefined) };
    mockedCreateTransport.mockReturnValue(transporter as unknown as nodemailer.Transporter);
    const logger = jest.spyOn(Logger.prototype, 'log');
    const service = new EmailService(
      {
        getValue: jest.fn().mockReturnValue('smtp'),
        get: jest.fn().mockReturnValue({
          mailProvider: 'smtp',
          smtpHost: '127.0.0.1',
          smtpPort,
          smtpUser,
          smtpPass,
        }),
      } as unknown as ConfigService,
      { emailLog: { create: jest.fn() } } as unknown as PrismaService,
    );

    expect(mockedCreateTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: '127.0.0.1',
      port: smtpPort,
      secure,
    }));
    const options = mockedCreateTransport.mock.calls[0][0] as { auth?: unknown };
    expect(options.auth).toEqual(auth);
    await expect(service.checkHealth()).resolves.toEqual({ status: 'up', provider: 'smtp' });
    expect(transporter.verify).toHaveBeenCalledTimes(1);
    expect(logger).not.toHaveBeenCalledWith(expect.stringContaining('secret'));
    logger.mockRestore();
  });

  it.each([
    ['mailer', undefined],
    [undefined, 'secret'],
  ])('rejects partial SMTP credentials', (smtpUser, smtpPass) => {
    expect(() => new EmailService(
      {
        getValue: jest.fn().mockReturnValue('smtp'),
        get: jest.fn().mockReturnValue({
          mailProvider: 'smtp',
          smtpHost: '127.0.0.1',
          smtpPort: 1025,
          smtpUser,
          smtpPass,
        }),
      } as unknown as ConfigService,
      { emailLog: { create: jest.fn() } } as unknown as PrismaService,
    )).toThrow('SMTP configuration incomplete');
  });

  it('reports SMTP readiness as down when transporter verification fails', async () => {
    const transporter = { verify: jest.fn().mockRejectedValue(new Error('connection refused')) };
    mockedCreateTransport.mockReturnValue(transporter as unknown as nodemailer.Transporter);
    const service = new EmailService(
      {
        getValue: jest.fn().mockReturnValue('smtp'),
        get: jest.fn().mockReturnValue({
          mailProvider: 'smtp',
          smtpHost: '127.0.0.1',
          smtpPort: 1025,
        }),
      } as unknown as ConfigService,
      { emailLog: { create: jest.fn() } } as unknown as PrismaService,
    );

    await expect(service.checkHealth()).resolves.toEqual({
      status: 'down',
      provider: 'smtp',
      error: 'connection refused',
    });
  });
});
