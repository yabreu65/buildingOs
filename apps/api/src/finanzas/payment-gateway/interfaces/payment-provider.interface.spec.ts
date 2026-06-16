/**
 * Tests for PaymentProvider interface
 * Task 1.3: Verify interface contract is properly exported
 */

import {
  PaymentProvider,
  CreatePreferenceInput,
  PaymentPreference,
  WebhookEvent,
  PaymentStatus,
  PAYMENT_PROVIDER_TOKEN,
} from './payment-provider.interface';

describe('PaymentProvider Interface', () => {
  it('exports the PAYMENT_PROVIDER_TOKEN constant', () => {
    expect(PAYMENT_PROVIDER_TOKEN).toBe('PAYMENT_PROVIDER');
  });

  it('allows implementing the interface with all required methods', () => {
    const mockProvider: PaymentProvider = {
      createPreference: jest.fn(),
      handleWebhook: jest.fn(),
      getChargeStatus: jest.fn(),
    };

    expect(mockProvider.createPreference).toBeDefined();
    expect(mockProvider.handleWebhook).toBeDefined();
    expect(mockProvider.getChargeStatus).toBeDefined();
  });

  it('CreatePreferenceInput accepts all required fields', () => {
    const input: CreatePreferenceInput = {
      chargeId: '123',
      tenantId: 'tenant-1',
      amount: 10000,
      currency: 'ARS',
      concept: 'Test charge',
    };

    expect(input.chargeId).toBe('123');
    expect(input.tenantId).toBe('tenant-1');
    expect(input.amount).toBe(10000);
  });

  it('PaymentPreference has required fields', () => {
    const preference: PaymentPreference = {
      preferenceId: 'pref-123',
      checkoutUrl: 'https://checkout.example.com/123',
      provider: 'mercadopago',
    };

    expect(preference.preferenceId).toBe('pref-123');
    expect(preference.provider).toBe('mercadopago');
  });

  it('WebhookEvent has required fields', () => {
    const event: WebhookEvent = {
      eventId: 'evt-123',
      eventType: 'payment.approved',
      status: 'PAID',
      rawPayload: { id: 'test' },
    };

    expect(event.eventId).toBe('evt-123');
    expect(event.status).toBe('PAID');
  });

  it('PaymentStatus has expected values', () => {
    const statuses: PaymentStatus[] = ['PENDING', 'PAID', 'REJECTED', 'CANCELLED'];
    expect(statuses).toHaveLength(4);
    expect(statuses).toContain('PAID');
    expect(statuses).toContain('REJECTED');
  });
});