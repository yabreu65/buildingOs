/**
 * MercadoPago Adapter — implements PaymentProvider interface
 * Task 2.1: Provider-agnostic payment processing via MercadoPago SDK (REST API)
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentProvider,
  CreatePreferenceInput,
  PaymentPreference,
  WebhookEvent,
  PaymentStatus,
} from '../interfaces/payment-provider.interface';

@Injectable()
export class MercadoPagoAdapter implements PaymentProvider {
  private readonly logger = new Logger(MercadoPagoAdapter.name);
  private readonly baseUrl = 'https://api.mercadopago.com';
  private readonly timeout = 10000;

  constructor(private readonly accessToken: string) {}

  async createPreference(input: CreatePreferenceInput): Promise<PaymentPreference> {
    const body = {
      items: [
        {
          id: input.chargeId,
          title: input.concept,
          quantity: 1,
          unit_price: input.amount / 100, // cents to currency units
          currency_id: input.currency,
        },
      ],
      external_reference: input.chargeId,
      metadata: {
        tenantId: input.tenantId,
        chargeId: input.chargeId,
        ...input.metadata,
      },
    };

    const response = await this.request('/checkout/preferences', 'POST', body);

    return {
      preferenceId: response.id,
      checkoutUrl: response.init_point,
      provider: 'mercadopago',
      expiresAt: response.expiration_date ? new Date(response.expiration_date) : undefined,
    };
  }

  async handleWebhook(payload: unknown, _signature: string): Promise<WebhookEvent> {
    const webhookData = payload as { action?: string; data?: { id?: string } };
    const paymentId = webhookData?.data?.id;

    if (!paymentId) {
      throw new Error('MercadoPago webhook: missing payment ID');
    }

    // Fetch the payment details to get the actual status
    const payment = await this.request(`/v1/payments/${paymentId}`, 'GET');

    const status = this.mapStatus(payment.status);
    const externalRef = payment.external_reference;

    return {
      eventId: String(payment.id),
      eventType: webhookData.action || 'payment.updated',
      chargeId: externalRef,
      externalId: String(payment.id),
      status,
      rawPayload: payload,
    };
  }

  async getChargeStatus(externalId: string): Promise<PaymentStatus> {
    const payment = await this.request(`/v1/payments/${externalId}`, 'GET');
    return this.mapStatus(payment.status);
  }

  private mapStatus(mpStatus: string): PaymentStatus {
    switch (mpStatus) {
      case 'approved':
        return 'PAID';
      case 'rejected':
      case 'charged_back':
        return 'REJECTED';
      case 'cancelled':
      case 'refunded':
        return 'CANCELLED';
      default:
        return 'PENDING';
    }
  }

  private async request(path: string, method: string, body?: unknown): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const options: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(`${this.baseUrl}${path}`, options);

      if (!response.ok) {
        throw new Error(`MercadoPago API error: ${response.status} ${response.statusText}`);
      }

      return response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }
}