/**
 * Email Delivery Resolver — reads MAIL_PROVIDER from environment.
 * Safe: defaults to 'none', validates required credentials, never logs secrets.
 */

import { EmailDeliveryOptions } from './email-delivery.module';

export function resolveEmailDelivery(env: NodeJS.ProcessEnv = process.env): EmailDeliveryOptions {
  const mailProvider = (env.MAIL_PROVIDER || 'none') as 'none' | 'smtp' | 'resend' | 'ses';
  const mailFrom = env.MAIL_FROM || 'BuildingOS <no-reply@buildingos.local>';

  if (mailProvider === 'none') {
    return { mailProvider, mailFrom };
  }

  if (mailProvider === 'smtp') {
    if (!env.SMTP_HOST) {
      throw new Error(
        'SMTP_HOST is required when MAIL_PROVIDER=smtp. ' +
        'Set the env var or switch to MAIL_PROVIDER=none.',
      );
    }
    const smtpUser = env.SMTP_USER || undefined;
    const smtpPass = env.SMTP_PASS || undefined;
    if (Boolean(smtpUser) !== Boolean(smtpPass)) {
      throw new Error('SMTP_USER and SMTP_PASS must both be set or both be empty when MAIL_PROVIDER=smtp.');
    }
    return {
      mailProvider,
      mailFrom,
      smtpHost: env.SMTP_HOST,
      smtpPort: env.SMTP_PORT ? Number(env.SMTP_PORT) : 587,
      smtpUser,
      smtpPass,
    };
  }

  if (mailProvider === 'resend') {
    if (!env.RESEND_API_KEY) {
      throw new Error(
        'RESEND_API_KEY is required when MAIL_PROVIDER=resend. ' +
        'Set the env var or switch to MAIL_PROVIDER=none.',
      );
    }
    return { mailProvider, mailFrom, resendApiKey: env.RESEND_API_KEY };
  }

  if (mailProvider === 'ses') {
    if (!env.SES_ACCESS_KEY || !env.SES_SECRET_KEY) {
      throw new Error(
        'SES_ACCESS_KEY and SES_SECRET_KEY are required when MAIL_PROVIDER=ses. ' +
        'Set the env vars or switch to MAIL_PROVIDER=none.',
      );
    }
    return {
      mailProvider,
      mailFrom,
      sesRegion: env.SES_REGION || 'us-east-1',
      sesAccessKey: env.SES_ACCESS_KEY,
      sesSecretKey: env.SES_SECRET_KEY,
    };
  }

  return { mailProvider, mailFrom };
}
