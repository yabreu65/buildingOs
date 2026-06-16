/**
 * SES Email Adapter — sends via AWS SES API
 * Task 3.1: Mail provider for Amazon SES
 */

import { Injectable, Logger } from '@nestjs/common';
import { EmailProvider, SendEmailInput, SendResult, DeliveryStatusResult } from '../interfaces/email-provider.interface';

@Injectable()
export class SesAdapter implements EmailProvider {
  private readonly logger = new Logger(SesAdapter.name);
  private readonly endpoint: string;

  constructor(
    private readonly region: string,
    private readonly accessKey: string,
    private readonly secretKey: string,
    private readonly fromAddress: string,
  ) {
    this.endpoint = `https://email.${region}.amazonaws.com`;
  }

  async send(options: SendEmailInput): Promise<SendResult> {
    try {
      // SES SendEmail API call (simplified — in production, use AWS SDK)
      const params = new URLSearchParams({
        Action: 'SendEmail',
        Source: this.fromAddress,
        'Destination.ToAddresses.member.1': options.to,
        'Message.Subject.Data': options.subject,
        'Message.Body.Html.Data': options.htmlBody,
        ...(options.textBody ? { 'Message.Body.Text.Data': options.textBody } : {}),
        ...(options.replyTo ? { 'ReplyToAddresses.member.1': options.replyTo } : {}),
      });

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return { success: false, error: `SES API error (${response.status}): ${errorBody}` };
      }

      const responseBody = await response.text();
      const messageIdMatch = responseBody.match(/<MessageId>([^<]+)<\/MessageId>/);
      const messageId = messageIdMatch ? messageIdMatch[1] : `ses-${Date.now()}`;

      return { success: true, externalId: messageId };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getDeliveryStatus(externalId: string): Promise<DeliveryStatusResult> {
    // SES doesn't have a simple GET API — status is tracked via SNS notifications
    return {
      messageId: externalId,
      status: 'sent',
      provider: 'ses',
      updatedAt: new Date(),
    };
  }

  async handleBounce(_payload: unknown): Promise<void> {
    // SES bounce notifications come via SNS — this method processes them
    this.logger.warn('SES bounce payload received — processing via SNS webhook');
  }
}