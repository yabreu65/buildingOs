/**
 * Email Service
 * Handles email sending via SMTP or Resend
 * Supports template rendering with tenant branding
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { SendEmailOptions, EmailType, TenantBranding, EmailProvider } from './email.types';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger('EmailService');
  private readonly provider: EmailProvider;
  private smtpTransporter?: nodemailer.Transporter;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.provider = this.config.getValue('mailProvider') as EmailProvider;
    this.initializeProvider();
  }

  /**
   * Initialize email provider
   */
  private initializeProvider(): void {
    if (this.provider === 'none') {
      this.logger.warn('[Email] Provider set to "none" - emails will not be sent');
      return;
    }

    if (this.provider === 'smtp') {
      this.initializeSMTP();
    } else if (this.provider === 'resend') {
      this.logger.log('[Email] Using Resend provider');
    } else if (this.provider === 'ses') {
      this.logger.warn('[Email] SES provider selected but not implemented yet');
    }
  }

  /**
   * Initialize SMTP transporter
   */
  private initializeSMTP(): void {
    const config = this.config.get();

    if (!config.smtpHost || !config.smtpPort || !config.smtpUser || !config.smtpPass) {
      throw new Error('SMTP configuration incomplete');
    }

    this.smtpTransporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465, // TLS for 465, STARTTLS for 587
      connectionTimeout: 3000,
      greetingTimeout: 3000,
      socketTimeout: 3000,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass,
      },
    });

    this.logger.log(`[Email] SMTP configured: ${config.smtpHost}:${config.smtpPort}`);
  }

  /**
   * Send email via configured provider
   * Logs errors but doesn't throw (email failures shouldn't break main flow)
   */
  async sendEmail(
    options: SendEmailOptions,
    emailType: EmailType,
  ): Promise<{ success: boolean; externalId?: string; error?: string }> {
    if (this.provider === 'none') {
      this.logger.debug(`[Email] Provider is "none", skipping: ${options.to}`);
      return { success: true }; // Don't fail if email is disabled
    }

    try {
      let externalId: string | undefined;

      if (this.provider === 'smtp') {
        externalId = await this.sendViaSMTP(options);
      } else if (this.provider === 'resend') {
        externalId = await this.sendViaResend(options);
      } else if (this.provider === 'ses') {
        throw new Error('SES provider is not implemented');
      }

      // Log email sent
      if (options.tenantId) {
        await this.prisma.emailLog.create({
          data: {
            tenantId: options.tenantId,
            type: emailType,
            to: options.to,
            subject: options.subject,
            status: 'SENT',
            provider: this.provider,
            externalId,
            sentAt: new Date(),
          },
        });
      }

      this.logger.log(`[Email] Sent ${emailType} to ${options.to} (${this.provider})`);
      return { success: true, externalId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[Email] Failed to send ${emailType} to ${options.to}: ${errorMessage}`);

      // Log email failed
      if (options.tenantId) {
        try {
          await this.prisma.emailLog.create({
            data: {
              tenantId: options.tenantId,
              type: emailType,
              to: options.to,
              subject: options.subject,
              status: 'FAILED',
              error: errorMessage.substring(0, 500),
              provider: this.provider,
            },
          });
        } catch (logError) {
          this.logger.error(`[Email] Failed to log email error: ${logError}`);
        }
      }

      // Audit failure (optional - don't fail if audit fails)
      // Note: EMAIL_SEND_FAILED action not in AuditAction enum yet
      // Can add in future or handle silently

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send via SMTP (local or external)
   */
  private async sendViaSMTP(options: SendEmailOptions): Promise<string> {
    if (!this.smtpTransporter) {
      throw new Error('SMTP not configured');
    }

    const config = this.config.get();
    const result = await this.smtpTransporter.sendMail({
      from: config.mailFrom,
      to: options.to,
      subject: options.subject,
      html: options.htmlBody,
      text: options.textBody || this.stripHtml(options.htmlBody),
      replyTo: options.replyTo,
    });

    return result.messageId || result.response;
  }

  /**
   * Send via Resend
   */
  private async sendViaResend(options: SendEmailOptions): Promise<string> {
    const config = this.config.get();

    if (!config.resendApiKey) {
      throw new Error('RESEND_API_KEY not configured');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: config.mailFrom,
          to: [options.to],
          subject: options.subject,
          html: options.htmlBody,
          text: options.textBody || this.stripHtml(options.htmlBody),
          reply_to: options.replyTo,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Resend API error (${response.status}): ${errorBody}`);
      }

      const data = (await response.json()) as { id?: string };
      return data.id || `resend-${Date.now()}`;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Get tenant branding for email templates
   */
  async getTenantBranding(tenantId?: string): Promise<TenantBranding> {
    if (!tenantId) {
      return {};
    }

    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          name: true,
          brandName: true,
          primaryColor: true,
          logoFileId: true,
        },
      });

      if (!tenant) {
        return {};
      }

      return {
        brandName: tenant.brandName || tenant.name,
        primaryColor: tenant.primaryColor || undefined,
        logoUrl: tenant.logoFileId ? `/files/${tenant.logoFileId}` : undefined,
        supportEmail: undefined, // TODO: Add to Tenant model if needed
      };
    } catch (error) {
      this.logger.error(`Failed to load branding for tenant ${tenantId}: ${error}`);
      return {};
    }
  }

  /**
   * Strip HTML tags for text version
   */
  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '');
  }

  /**
   * Check if email service is available
   */
  isEmailAvailable(): boolean {
    return this.provider !== 'none';
  }

  /**
   * Verify whether the configured provider is reachable.
   */
  async checkHealth(): Promise<{ status: 'up' | 'down' | 'not_configured'; provider: string; error?: string }> {
    if (this.provider === 'none') {
      return { status: 'not_configured', provider: 'disabled' };
    }

    try {
      if (this.provider === 'smtp') {
        if (!this.smtpTransporter) {
          return { status: 'down', provider: 'smtp', error: 'SMTP transporter not configured' };
        }

        await this.smtpTransporter.verify();
        return { status: 'up', provider: 'smtp' };
      }

      if (this.provider === 'resend') {
        const config = this.config.get();
        if (!config.resendApiKey) {
          return { status: 'down', provider: 'resend', error: 'RESEND_API_KEY not configured' };
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        try {
          const response = await fetch('https://api.resend.com/domains', {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${config.resendApiKey}`,
            },
            signal: controller.signal,
          });

          if (!response.ok) {
            const errorBody = await response.text();
            return {
              status: 'down',
              provider: 'resend',
              error: `Resend health check failed (${response.status}): ${errorBody}`,
            };
          }

          return { status: 'up', provider: 'resend' };
        } finally {
          clearTimeout(timeout);
        }
      }

      return { status: 'down', provider: this.provider, error: `${this.provider} provider is not implemented` };
    } catch (error) {
      return {
        status: 'down',
        provider: this.provider,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
