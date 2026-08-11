/**
 * Payment Provider Interface
 * Task 1.3: Provider-agnostic payment interface for charge creation,
 * webhook processing, and status queries.
 */

export interface CreatePreferenceInput {
  chargeId: string;
  tenantId: string;
  amount: number; // cents
  currency: string;
  concept: string;
  externalReference?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentPreference {
  preferenceId: string;
  checkoutUrl: string;
  provider: PaymentProviderName;
  expiresAt?: Date;
}

export interface WebhookEvent {
  eventId: string;
  eventType: string;
  chargeId?: string;
  externalId?: string;
  status: PaymentStatus;
  /**
   * Verified financial amount in minor units, as reported by the provider.
   * Absent when the provider event does not carry verifiable amount evidence.
   */
  amount?: number;
  /**
   * Verified currency of the payment, as reported by the provider.
   * Absent when the provider event does not carry verifiable currency evidence.
   */
  currency?: string;
  /**
   * Economic payment date (YYYY-MM-DD) as declared/verified by the provider.
   * MP: date_approved (fallback transaction_details.transaction_date), using
   * the provider-declared calendar day (never UTC-shifted). Stripe: the
   * success event timestamp as UTC calendar date. Absent when the provider
   * event does not carry a defensible economic date.
   */
  paidAt?: string;
  rawPayload: unknown;
}

export interface WebhookSignatureContext {
  signature?: string;
  requestId?: string;
  dataId?: string;
  provider?: PaymentProviderName;
}

export type PaymentStatus = 'PENDING' | 'PAID' | 'REJECTED' | 'CANCELLED';

export type PaymentProviderName = 'mercadopago' | 'stripe';

export type ConfiguredPaymentProviderName = PaymentProviderName | 'none';

export interface PaymentProvider {
  /**
   * Canonical provider identity for this configured adapter.
   */
  readonly providerName: PaymentProviderName;

  /**
   * Create a payment preference (checkout link) for a charge
   */
  createPreference(input: CreatePreferenceInput): Promise<PaymentPreference>;

  /**
   * Process an incoming webhook payload from the provider
   */
  handleWebhook(
    payload: unknown,
    signature: string,
    signatureContext?: WebhookSignatureContext,
  ): Promise<WebhookEvent>;

  /**
   * Query the current status of a charge from the provider
   */
  getChargeStatus(externalId: string): Promise<PaymentStatus>;
}

export const PAYMENT_PROVIDER_TOKEN = 'PAYMENT_PROVIDER';
