/**
 * MercadoPago Adapter — implements PaymentProvider interface
 * Task 2.1: Provider-agnostic payment processing via MercadoPago SDK (REST API)
 */

import { BadRequestException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  PaymentProvider,
  CreatePreferenceInput,
  PaymentPreference,
  WebhookEvent,
  PaymentStatus,
  PaymentProviderName,
  WebhookSignatureContext,
} from '../interfaces/payment-provider.interface';

@Injectable()
export class MercadoPagoAdapter implements PaymentProvider {
  readonly providerName: PaymentProviderName = 'mercadopago';

  private readonly logger = new Logger(MercadoPagoAdapter.name);
  private readonly baseUrl = 'https://api.mercadopago.com';
  private readonly timeout = 10000;

  constructor(
    private readonly accessToken: string,
    private readonly webhookSecret?: string,
  ) {}

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

  async handleWebhook(
    payload: unknown,
    signature: string,
    signatureContext: WebhookSignatureContext = {},
  ): Promise<WebhookEvent> {
    const webhookData = payload as { action?: string; data?: { id?: string } };
    const context = { ...signatureContext, signature };
    const paymentId = context.dataId;

    if (!paymentId) {
      throw new BadRequestException('MercadoPago webhook: missing payment ID');
    }

    this.validateWebhookSignature(context, paymentId);

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

  private validateWebhookSignature(signatureContext: WebhookSignatureContext, dataId: string): void {
    if (!this.webhookSecret) {
      throw new ServiceUnavailableException('MercadoPago webhook: missing webhook secret');
    }
    if (!signatureContext.signature) {
      throw new UnauthorizedException('MercadoPago webhook: missing signature');
    }
    if (!signatureContext.requestId) {
      throw new BadRequestException('MercadoPago webhook: missing request ID');
    }

    const signatureParts = this.parseSignature(signatureContext.signature);
    const timestamp = signatureParts.get('ts');
    const receivedDigest = signatureParts.get('v1');

    if (!timestamp || !/^\d+$/.test(timestamp)) {
      throw new BadRequestException('MercadoPago webhook: missing or malformed timestamp');
    }
    if (!receivedDigest || !/^[a-fA-F0-9]{64}$/.test(receivedDigest)) {
      throw new BadRequestException('MercadoPago webhook: missing or malformed v1 signature');
    }

    const manifest = `id:${dataId};request-id:${signatureContext.requestId};ts:${timestamp};`;
    const expectedDigest = createHmac('sha256', this.webhookSecret)
      .update(manifest)
      .digest('hex');

    const expected = Buffer.from(expectedDigest, 'hex');
    const received = Buffer.from(receivedDigest, 'hex');

    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new UnauthorizedException('MercadoPago webhook: invalid signature');
    }
  }

  private parseSignature(signature: string): Map<string, string> {
    const parts = new Map<string, string>();

    for (const rawPart of signature.split(',')) {
      const [rawKey, rawValue] = rawPart.split('=');
      const key = rawKey?.trim();
      const value = rawValue?.trim();

      if (key && value) {
        parts.set(key, value);
      }
    }

    return parts;
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
