/**
 * Email service types and interfaces
 */

export type EmailProvider = 'none' | 'smtp' | 'sendgrid' | 'mailgun';

export interface SendEmailOptions {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  replyTo?: string;
  tenantId?: string;
}

export interface EmailTemplateData {
  [key: string]: string | number | boolean | null | undefined;
}

export enum EmailType {
  INVITATION = 'INVITATION',
  PASSWORD_RESET = 'PASSWORD_RESET',
  PAYMENT_SUBMITTED = 'PAYMENT_SUBMITTED',
}

export interface EmailLog {
  id: string;
  tenantId?: string;
  type: EmailType;
  to: string;
  subject: string;
  status: 'SENT' | 'FAILED' | 'BOUNCED';
  error?: string;
  provider: EmailProvider;
  externalId?: string; // SendGrid message ID, etc.
  createdAt: Date;
  sentAt?: Date;
}

export interface SMTPConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure?: boolean; // TLS
}

export interface SendGridConfig {
  apiKey: string;
  from: string;
}

export interface MailgunConfig {
  apiKey: string;
  domain: string;
  from: string;
}

export interface TenantBranding {
  brandName?: string;
  primaryColor?: string;
  logoUrl?: string;
  supportEmail?: string;
}
