/**
 * Stripe Adapter — implements PaymentProvider interface
 * Task 2.2: Provider-agnostic payment processing via Stripe REST API
 */

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  PaymentProvider,
  CreatePreferenceInput,
  PaymentPreference,
  WebhookEvent,
  PaymentStatus,
  PaymentProviderName,
} from '../interfaces/payment-provider.interface';

@Injectable()
export class StripeAdapter implements PaymentProvider {
  readonly providerName: PaymentProviderName = 'stripe';

  private readonly logger = new Logger(StripeAdapter.name);
  private readonly baseUrl = 'https://api.stripe.com/v1';
  private readonly timeout = 10000;

  constructor(private readonly secretKey: string) {}

  async createPreference(input: CreatePreferenceInput): Promise<PaymentPreference> {
    const body = new URLSearchParams({
      'mode': 'payment',
      'line_items[0][price_data][currency]': input.currency.toLowerCase(),
      'line_items[0][price_data][product_data][name]': input.concept,
      'line_items[0][price_data][unit_amount]': String(input.amount),
      'line_items[0][quantity]': '1',
      'metadata[chargeId]': input.chargeId,
      'metadata[tenantId]': input.tenantId,
    });

    if (input.metadata?.successUrl) {
      body.set('success_url', String(input.metadata.successUrl));
    }
    if (input.metadata?.cancelUrl) {
      body.set('cancel_url', String(input.metadata.cancelUrl));
    }

    const response = await this.request('/checkout/sessions', 'POST', body.toString());

    return {
      preferenceId: response.id,
      checkoutUrl: response.url,
      provider: 'stripe',
      expiresAt: response.expires_at ? new Date(response.expires_at * 1000) : undefined,
    };
  }

  async handleWebhook(payload: unknown, _signature: string): Promise<WebhookEvent> {
    const event = payload as { type?: string; data?: { object?: Record<string, unknown> } };
    const eventType = event.type;

    if (!eventType) {
      throw new BadRequestException('Stripe webhook: missing event type');
    }

    const session = event.data?.object;
    if (!session) {
      throw new BadRequestException('Stripe webhook: missing session data');
    }

    const sessionId = String(session.id || '');
    const paymentStatus = String(session.payment_status || '');
    const metadata = (session.metadata || {}) as Record<string, string>;
    const chargeId = metadata.chargeId;

    let status: PaymentStatus;
    switch (eventType) {
      case 'checkout.session.completed':
        status = paymentStatus === 'paid' ? 'PAID' : 'PENDING';
        break;
      case 'checkout.session.expired':
        status = 'CANCELLED';
        break;
      default:
        status = 'PENDING';
    }

    return {
      eventId: sessionId,
      eventType,
      chargeId,
      externalId: sessionId,
      status,
      rawPayload: payload,
    };
  }

  async getChargeStatus(externalId: string): Promise<PaymentStatus> {
    const session = await this.request(`/checkout/sessions/${externalId}`, 'GET');

    switch (session.payment_status) {
      case 'paid':
        return 'PAID';
      case 'unpaid':
        return 'CANCELLED';
      default:
        return 'PENDING';
    }
  }

  private async request(path: string, method: string, body?: string): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const options: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': method === 'POST' ? 'application/x-www-form-urlencoded' : 'application/json',
        },
        signal: controller.signal,
      };

      if (body) {
        options.body = body;
      }

      const response = await fetch(`${this.baseUrl}${path}`, options);

      if (!response.ok) {
        throw new Error(`Stripe API error: ${response.status} ${response.statusText}`);
      }

      return response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
