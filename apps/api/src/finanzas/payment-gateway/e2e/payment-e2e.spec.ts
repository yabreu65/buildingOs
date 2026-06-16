/**
 * E2E Payment Integration Test
 * Task 5.1: charge→mock webhook→PAID + ProcessedWebhookEvent created
 */

import { PaymentGatewayService } from '../payment-gateway.service';
import { PaymentProvider, PaymentPreference, WebhookEvent, PaymentStatus } from '../interfaces/payment-provider.interface';
import { PAYMENT_PROVIDER_TOKEN } from '../interfaces/payment-provider.interface';

// Mock provider for E2E testing
class MockPaymentProvider implements PaymentProvider {
  async createPreference(): Promise<PaymentPreference> {
    return { preferenceId: 'mock-pref-1', checkoutUrl: 'https://mock-pay.com/1', provider: 'mercadopago' };
  }

  async handleWebhook(payload: unknown, _signature: string): Promise<WebhookEvent> {
    const data = payload as { action?: string; data?: { id?: string } };
    return {
      eventId: data?.data?.id || 'mock-evt-1',
      eventType: data?.action || 'payment.approved',
      status: 'PAID',
      rawPayload: payload,
    };
  }

  async getChargeStatus(): Promise<PaymentStatus> {
    return 'PAID';
  }
}

describe('E2E Payment Flow', () => {
  let service: PaymentGatewayService;
  let mockProvider: jest.Mocked<MockPaymentProvider>;
  let mockPrisma: any;
  let mockIdempotencyService: any;

  beforeEach(() => {
    mockProvider = new MockPaymentProvider() as jest.Mocked<MockPaymentProvider>;
    mockProvider.createPreference = jest.fn().mockResolvedValue({
      preferenceId: 'mock-pref-1',
      checkoutUrl: 'https://mock-pay.com/1',
      provider: 'mercadopago',
    });
    mockProvider.handleWebhook = jest.fn().mockResolvedValue({
      eventId: 'mock-evt-1',
      eventType: 'payment.approved',
      status: 'PAID',
      rawPayload: {},
    });
    mockProvider.getChargeStatus = jest.fn().mockResolvedValue('PAID');

    mockPrisma = {
      charge: { findUnique: jest.fn(), update: jest.fn() },
      payment: { findFirst: jest.fn(), update: jest.fn() },
    };
    mockIdempotencyService = {
      isProcessed: jest.fn(),
      markProcessed: jest.fn(),
    };

    service = new PaymentGatewayService(mockProvider as any, mockPrisma, mockIdempotencyService);
  });

  it('creates a payment preference and processes webhook to PAID', async () => {
    // Step 1: Create preference
    const preference = await service.createPreference({
      chargeId: 'charge-e2e-1',
      tenantId: 'tenant-e2e',
      amount: 10000,
      currency: 'ARS',
      concept: 'Expensas E2E',
    });

    expect(preference.preferenceId).toBe('mock-pref-1');
    expect(preference.checkoutUrl).toBe('https://mock-pay.com/1');
    expect(preference.provider).toBe('mercadopago');

    // Step 2: Process webhook (charge is PENDING, webhook says PAID)
    mockPrisma.charge.findUnique.mockResolvedValue({ id: 'charge-e2e-1', status: 'PENDING' });
    mockPrisma.charge.update.mockResolvedValue({ id: 'charge-e2e-1', status: 'PAID' });
    mockPrisma.payment.findFirst.mockResolvedValue(null);
    mockIdempotencyService.isProcessed.mockResolvedValue(false);
    mockIdempotencyService.markProcessed.mockResolvedValue(undefined);

    const result = await service.processWebhookEvent(
      { action: 'payment.approved', data: { id: 'mock-evt-1' } },
      'mock-signature',
      'mercadopago',
    );

    // Step 3: Verify charge was processed
    expect(result.status).toBe('PAID');
    // Verify IdempotencyService was called correctly
    expect(mockIdempotencyService.isProcessed).toHaveBeenCalledWith('mock-evt-1', 'mercadopago');
    expect(mockIdempotencyService.markProcessed).toHaveBeenCalledWith('mock-evt-1', 'mercadopago');
  });

  it('rejects duplicate webhook delivery (idempotency)', async () => {
    // Simulate already-processed event via IdempotencyService
    mockIdempotencyService.isProcessed.mockResolvedValue(true);

    const result = await service.processWebhookEvent({}, 'sig', 'mercadopago');

    // Should return early — charge should not be updated
    expect(result.chargeUpdated).toBe(false);
    expect(mockIdempotencyService.markProcessed).not.toHaveBeenCalled();
  });
});