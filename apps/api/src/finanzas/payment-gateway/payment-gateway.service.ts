/**
 * PaymentGatewayService — delegates to active provider adapter
 * Task 2.3: Orchestrates payment creation, webhook handling, and charge confirmation
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  PaymentProvider,
  CreatePreferenceInput,
  PaymentPreference,
  WebhookEvent,
  PaymentStatus,
  PAYMENT_PROVIDER_TOKEN,
  PaymentProviderName,
} from './interfaces/payment-provider.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { IdempotencyService } from './webhooks/idempotency.service';
import { ChargeStatus } from '@prisma/client';
import { Inject } from '@nestjs/common';

@Injectable()
export class PaymentGatewayService {
  private readonly logger = new Logger(PaymentGatewayService.name);

  constructor(
    @Optional() @Inject(PAYMENT_PROVIDER_TOKEN) private readonly provider: PaymentProvider | null,
    private readonly prisma: PrismaService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  /**
   * Create a payment preference (checkout link) for a charge
   */
  async createPreference(input: CreatePreferenceInput): Promise<PaymentPreference> {
    if (!this.provider) throw new Error('Payment provider not configured');
    return this.provider.createPreference(input);
  }

  /**
   * Return the canonical provider configured for this gateway instance.
   */
  getActiveProviderName(): PaymentProviderName | null {
    return this.provider?.providerName ?? null;
  }

  /**
   * Process a webhook event after signature validation
   */
  async processWebhookEvent(
    payload: unknown,
    signature: string,
    requestedProviderName?: PaymentProviderName,
  ): Promise<WebhookEvent & { chargeUpdated?: boolean }> {
    if (!this.provider) throw new Error('Payment provider not configured');
    const providerName = this.provider.providerName;

    if (requestedProviderName && requestedProviderName !== providerName) {
      throw new Error(`Webhook provider mismatch: active provider is ${providerName}`);
    }

    const event = await this.provider.handleWebhook(payload, signature);

    // Idempotency: check via dedicated IdempotencyService
    const isDuplicate = await this.idempotencyService.isProcessed(event.eventId, providerName);
    if (isDuplicate) {
      this.logger.log(`Webhook event ${event.eventId} already processed, skipping`);
      return { ...event, chargeUpdated: false };
    }

    // Mark as processed
    await this.idempotencyService.markProcessed(event.eventId, providerName);

    // Confirm charge status
    let chargeUpdated = false;
    if (event.chargeId && (event.status === 'PAID' || event.status === 'REJECTED' || event.status === 'CANCELLED')) {
      const charge = await this.prisma.charge.findUnique({
        where: { id: event.chargeId },
      });

      if (charge && charge.status === 'PENDING') {
        await this.prisma.charge.update({
          where: { id: event.chargeId },
          data: { status: event.status as ChargeStatus, paymentExternalId: event.externalId },
        });
        chargeUpdated = true;
        this.logger.log(`Charge ${event.chargeId} updated to ${event.status}`);
      }
    }

    // Record event on payment if available
    if (event.externalId) {
      const payment = await this.prisma.payment.findFirst({
        where: { reference: event.externalId },
      });
      if (payment) {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { paymentEventId: event.eventId },
        });
      }
    }

    return { ...event, chargeUpdated };
  }

  /**
   * Get the status of a charge from the provider
   */
  async getChargeStatus(externalId: string): Promise<PaymentStatus> {
    if (!this.provider) throw new Error('Payment provider not configured');
    return this.provider.getChargeStatus(externalId);
  }
}
