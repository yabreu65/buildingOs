/**
 * Email Provider Interface
 * Task 1.4: Provider-agnostic email sending, delivery status, and bounce handling.
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  replyTo?: string;
  tenantId?: string;
}

export interface SendResult {
  success: boolean;
  externalId?: string;
  error?: string;
}

export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'bounced' | 'failed' | 'skipped';

export interface DeliveryStatusResult {
  messageId: string;
  status: DeliveryStatus;
  provider: string;
  updatedAt: Date;
}

export interface EmailProvider {
  /**
   * Send an email
   */
  send(options: SendEmailInput): Promise<SendResult>;

  /**
   * Get the delivery status of a previously sent email
   */
  getDeliveryStatus(externalId: string): Promise<DeliveryStatusResult>;

  /**
   * Handle a bounce notification payload from the provider
   */
  handleBounce(payload: unknown): Promise<void>;
}

export const EMAIL_PROVIDER_TOKEN = 'EMAIL_PROVIDER';