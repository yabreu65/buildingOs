/**
 * EmailBounceController — processes bounce webhook notifications
 * Task 3.5: Marks emails as bounced, flags users
 */

import { Controller, Post, Body, Logger } from '@nestjs/common';
import { DeliveryTrackingService } from '../delivery-tracking.service';

@Controller('webhooks/email/bounce')
export class EmailBounceController {
  private readonly logger = new Logger(EmailBounceController.name);

  constructor(private readonly trackingService: DeliveryTrackingService) {}

  @Post()
  async handleBounce(
    @Body() payload: { messageId?: string; recipient?: string; reason?: string },
  ): Promise<{ status: string }> {
    this.logger.warn(`Email bounce received: ${payload.messageId} → ${payload.recipient}`);

    if (!payload.messageId) {
      this.logger.warn('Bounce payload missing messageId');
      return { status: 'ignored' };
    }

    const delivery = await this.trackingService.getByMessageId(payload.messageId);

    if (!delivery) {
      this.logger.warn(`No delivery record found for bounce: ${payload.messageId}`);
      return { status: 'not_found' };
    }

    await this.trackingService.markBounced(delivery.id);

    // TODO: Flag user as having bounced email (future enhancement)

    return { status: 'bounced' };
  }
}