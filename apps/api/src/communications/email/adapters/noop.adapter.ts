/**
 * NoOp Email Adapter — returns success without sending
 * Task 3.1: Graceful degradation when MAIL_PROVIDER=none
 */

import { Injectable } from '@nestjs/common';
import { EmailProvider, SendEmailInput, SendResult, DeliveryStatusResult } from '../interfaces/email-provider.interface';

@Injectable()
export class NoOpAdapter implements EmailProvider {
  async send(options: SendEmailInput): Promise<SendResult> {
    return {
      success: true,
      externalId: `noop-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    };
  }

  async getDeliveryStatus(externalId: string): Promise<DeliveryStatusResult> {
    return {
      messageId: externalId,
      status: 'skipped',
      provider: 'noop',
      updatedAt: new Date(),
    };
  }

  async handleBounce(_payload: unknown): Promise<void> {
    // No-op: nothing to process for disabled email
  }
}