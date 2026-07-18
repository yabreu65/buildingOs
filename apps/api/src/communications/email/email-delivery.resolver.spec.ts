/**
 * Tests for Email Delivery Resolver
 * Verifies: default=none, reads env vars, missing creds fail with clear error
 */

import { resolveEmailDelivery } from './email-delivery.resolver';

describe('resolveEmailDelivery', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.MAIL_PROVIDER;
    delete process.env.MAIL_FROM;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.RESEND_API_KEY;
    delete process.env.SES_REGION;
    delete process.env.SES_ACCESS_KEY;
    delete process.env.SES_SECRET_KEY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('default behavior', () => {
    it('returns provider=none when MAIL_PROVIDER is not set', () => {
      const result = resolveEmailDelivery({});
      expect(result.mailProvider).toBe('none');
      expect(result.mailFrom).toContain('no-reply');
    });

    it('returns provider=none when MAIL_PROVIDER is empty', () => {
      const result = resolveEmailDelivery({ MAIL_PROVIDER: '' });
      expect(result.mailProvider).toBe('none');
    });
  });

  describe('smtp provider', () => {
    it('reads SMTP config from env', () => {
      const result = resolveEmailDelivery({
        MAIL_PROVIDER: 'smtp',
        MAIL_FROM: 'app@example.com',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '465',
        SMTP_USER: 'user',
        SMTP_PASS: 'pass',
      });
      expect(result.mailProvider).toBe('smtp');
      expect(result.mailFrom).toBe('app@example.com');
      expect(result.smtpHost).toBe('smtp.example.com');
      expect(result.smtpPort).toBe(465);
    });

    it('fails when SMTP_HOST is missing', () => {
      expect(() =>
        resolveEmailDelivery({ MAIL_PROVIDER: 'smtp' }),
      ).toThrow('SMTP_HOST is required when MAIL_PROVIDER=smtp');
    });

    it('supports unauthenticated local SMTP when both credentials are empty', () => {
      const result = resolveEmailDelivery({
        MAIL_PROVIDER: 'smtp',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        SMTP_USER: '',
        SMTP_PASS: '',
      });

      expect(result).toEqual(expect.objectContaining({
        smtpHost: '127.0.0.1',
        smtpPort: 1025,
        smtpUser: undefined,
        smtpPass: undefined,
      }));
    });

    it.each([
      { SMTP_USER: 'mailer' },
      { SMTP_PASS: 'secret' },
    ])('rejects partial SMTP credentials: %o', (credentials) => {
      expect(() => resolveEmailDelivery({
        MAIL_PROVIDER: 'smtp',
        SMTP_HOST: 'smtp.example.com',
        ...credentials,
      })).toThrow('SMTP_USER and SMTP_PASS must both be set or both be empty');
    });
  });

  describe('resend provider', () => {
    it('reads RESEND_API_KEY from env', () => {
      const result = resolveEmailDelivery({
        MAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_123',
      });
      expect(result.mailProvider).toBe('resend');
      expect(result.resendApiKey).toBe('re_123');
    });

    it('fails when RESEND_API_KEY is missing', () => {
      expect(() =>
        resolveEmailDelivery({ MAIL_PROVIDER: 'resend' }),
      ).toThrow('RESEND_API_KEY is required when MAIL_PROVIDER=resend');
    });
  });

  describe('ses provider', () => {
    it('reads SES config from env', () => {
      const result = resolveEmailDelivery({
        MAIL_PROVIDER: 'ses',
        SES_REGION: 'sa-east-1',
        SES_ACCESS_KEY: 'AKID',
        SES_SECRET_KEY: 'secret',
      });
      expect(result.mailProvider).toBe('ses');
      expect(result.sesRegion).toBe('sa-east-1');
      expect(result.sesAccessKey).toBe('AKID');
    });

    it('fails when SES_ACCESS_KEY is missing', () => {
      expect(() =>
        resolveEmailDelivery({
          MAIL_PROVIDER: 'ses',
          SES_SECRET_KEY: 'secret',
        }),
      ).toThrow('SES_ACCESS_KEY and SES_SECRET_KEY are required when MAIL_PROVIDER=ses');
    });
  });
});
