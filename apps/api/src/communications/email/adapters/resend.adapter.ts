/**
 * Resend Email Adapter — sends via Resend REST API
 * Task 3.1: Mail provider for resend.com
 */

import { Injectable, Logger } from '@nestjs/common';
import { EmailProvider, SendEmailInput, SendResult, DeliveryStatusResult } from '../interfaces/email-provider.interface';

@Injectable()
export class ResendAdapter implements EmailProvider {
  private readonly logger = new Logger(ResendAdapter.name);
  private readonly baseUrl = 'https://api.resend.com';

  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
  ) {}

  async send(options: SendEmailInput): Promise<SendResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${this.baseUrl}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.fromAddress,
          to: [options.to],
          subject: options.subject,
          html: options.htmlBody,
          text: options.textBody || options.htmlBody.replace(/<[^>]*>/g, ''),
          reply_to: options.replyTo,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return { success: false, error: `Resend API error (${response.status}): ${errorBody}` };
      }

      const data = (await response.json()) as { id?: string };
      return { success: true, externalId: data.id || `resend-${Date.now()}` };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timeout);
    }
  }

  async getDeliveryStatus(externalId: string): Promise<DeliveryStatusResult> {
    try {
      const response = await fetch(`${this.baseUrl}/emails/${externalId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!response.ok) {
        return {
          messageId: externalId,
          status: 'failed',
          provider: 'resend',
          updatedAt: new Date(),
        };
      }

      const data = (await response.json()) as { status?: string };
      const statusMap: Record<string, DeliveryStatusResult['status']> = {
        delivered: 'delivered',
        sent: 'sent',
        bounced: 'bounced',
        complained: 'bounced',
        failed: 'failed',
      };

      return {
        messageId: externalId,
        status: statusMap[data.status || ''] || 'sent',
        provider: 'resend',
        updatedAt: new Date(),
      };
    } catch {
      return {
        messageId: externalId,
        status: 'failed',
        provider: 'resend',
        updatedAt: new Date(),
      };
    }
  }

  async handleBounce(_payload: unknown): Promise<void> {
    // Resend bounce notifications are handled via webhook
    // This method is for direct API bounce processing
    this.logger.warn('Resend bounce payload received — processing is webhook-driven');
  }
}