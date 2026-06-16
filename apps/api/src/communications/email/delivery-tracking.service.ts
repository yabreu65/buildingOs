/**
 * DeliveryTrackingService — tracks EmailDelivery records
 * Task 3.4: queued→sent→delivered→bounced→failed status transitions
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DeliveryTrackingService {
  private readonly logger = new Logger(DeliveryTrackingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new email delivery record with status 'queued'
   */
  async createQueued(params: {
    tenantId: string;
    messageId: string;
    to: string;
    subject: string;
    provider: string;
  }): Promise<{ id: string; status: string }> {
    return this.prisma.emailDelivery.create({
      data: {
        tenantId: params.tenantId,
        messageId: params.messageId,
        to: params.to,
        subject: params.subject,
        status: 'queued',
        provider: params.provider,
      },
    });
  }

  /**
   * Update delivery status to 'sent'
   */
  async markSent(id: string, externalId?: string): Promise<void> {
    await this.prisma.emailDelivery.update({
      where: { id },
      data: {
        status: 'sent',
        externalId: externalId || undefined,
      },
    });
  }

  /**
   * Update delivery status to 'delivered'
   */
  async markDelivered(id: string): Promise<void> {
    await this.prisma.emailDelivery.update({
      where: { id },
      data: { status: 'delivered' },
    });
  }

  /**
   * Update delivery status to 'bounced'
   */
  async markBounced(id: string): Promise<void> {
    await this.prisma.emailDelivery.update({
      where: { id },
      data: { status: 'bounced' },
    });
  }

  /**
   * Update delivery status to 'failed'
   */
  async markFailed(id: string, error?: string): Promise<void> {
    await this.prisma.emailDelivery.update({
      where: { id },
      data: { status: 'failed' },
    });
    if (error) {
      this.logger.error(`Email delivery failed for ${id}: ${error}`);
    }
  }

  /**
   * Get delivery status by message ID
   */
  async getByMessageId(messageId: string): Promise<{ id: string; status: string; provider: string } | null> {
    return this.prisma.emailDelivery.findFirst({
      where: { messageId },
      select: { id: true, status: true, provider: true },
    });
  }
}