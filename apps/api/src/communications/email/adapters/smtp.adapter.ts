/**
 * SMTP Email Adapter — sends via SMTP using nodemailer
 * Task 3.1: Extracted from existing EmailService
 */

import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EmailProvider, SendEmailInput, SendResult, DeliveryStatusResult } from '../interfaces/email-provider.interface';
import { SMTPConfig } from '../../../email/email.types';

@Injectable()
export class SmtpAdapter implements EmailProvider {
  private readonly logger = new Logger(SmtpAdapter.name);
  private transporter?: nodemailer.Transporter;

  constructor(private readonly config: SMTPConfig) {
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    const hasSmtpUser = Boolean(this.config.user);
    const hasSmtpPass = Boolean(this.config.pass);
    if (hasSmtpUser !== hasSmtpPass) {
      throw new Error('SMTP authentication requires both user and password');
    }

    const transportOptions = {
      host: this.config.host,
      port: this.config.port,
      secure: this.config.port === 465,
    };
    this.transporter = nodemailer.createTransport(
      hasSmtpUser && hasSmtpPass
        ? {
            ...transportOptions,
            auth: {
              user: this.config.user!,
              pass: this.config.pass!,
            },
          }
        : transportOptions,
    );
  }

  async send(options: SendEmailInput): Promise<SendResult> {
    if (!this.transporter) {
      return { success: false, error: 'SMTP transporter not configured' };
    }

    try {
      const result = await this.transporter.sendMail({
        from: this.config.from,
        to: options.to,
        subject: options.subject,
        html: options.htmlBody,
        text: options.textBody || options.htmlBody.replace(/<[^>]*>/g, ''),
        replyTo: options.replyTo,
      });

      return {
        success: true,
        externalId: result.messageId || result.response || `smtp-${Date.now()}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getDeliveryStatus(externalId: string): Promise<DeliveryStatusResult> {
    // SMTP doesn't have delivery tracking — return sent as best guess
    return {
      messageId: externalId,
      status: 'sent',
      provider: 'smtp',
      updatedAt: new Date(),
    };
  }

  async handleBounce(_payload: unknown): Promise<void> {
    // SMTP bounces are received as email — handled differently
    this.logger.warn('SMTP bounce detected — manual processing required');
  }
}
