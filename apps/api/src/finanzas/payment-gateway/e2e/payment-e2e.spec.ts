/**
 * E2E Payment Integration Test
 * Task 5.1: charge→mock webhook→PAID + ProcessedWebhookEvent created
 */

import { PaymentGatewayService } from '../payment-gateway.service';
import { PaymentProvider, PaymentPreference, WebhookEvent, PaymentStatus } from '../interfaces/payment-provider.interface';
import { PAYMENT_PROVIDER_TOKEN } from '../interfaces/payment-provider.interface';

// Mock provider for E2E testing
class MockPaymentProvider implements PaymentProvider {
  readonly providerName = 'mercadopago' as const;

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
    const createdAllocations: Array<{ amount: number }> = [];
    let paymentRecord = {
      id: 'payment-e2e-1',
      tenantId: 'tenant-e2e',
      buildingId: 'building-e2e',
      unitId: 'unit-e2e',
      amount: 10000,
      currency: 'ARS',
      status: 'SUBMITTED',
      reference: 'mock-ext-1',
      paymentAllocations: [] as Array<Record<string, unknown>>,
    };
    mockProvider = new MockPaymentProvider() as jest.Mocked<MockPaymentProvider>;
    mockProvider.createPreference = jest.fn().mockResolvedValue({
      preferenceId: 'mock-pref-1',
      checkoutUrl: 'https://mock-pay.com/1',
      provider: 'mercadopago',
    });
    mockProvider.handleWebhook = jest.fn().mockResolvedValue({
      eventId: 'mock-evt-1',
      eventType: 'payment.approved',
      chargeId: 'charge-e2e-1',
      externalId: 'mock-ext-1',
      status: 'PAID',
      amount: 10000,
      currency: 'ARS',
      paidAt: '2026-08-10',
      rawPayload: {},
    });
    mockProvider.getChargeStatus = jest.fn().mockResolvedValue('PAID');

    mockPrisma = {
      tenant: {
        findFirst: jest.fn().mockResolvedValue({ id: 'tenant-e2e', functionalCurrency: 'ARS' }),
      },
      charge: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'charge-e2e-1',
          tenantId: 'tenant-e2e',
          buildingId: 'building-e2e',
          unitId: 'unit-e2e',
          amount: 10000,
          currency: 'ARS',
          status: 'PENDING',
          paymentAllocations: [],
        }),
        findUnique: jest.fn().mockImplementation(() => Promise.resolve({
          id: 'charge-e2e-1',
          amount: 10000,
          currency: 'ARS',
          status: createdAllocations.length === 0 ? 'PENDING' : 'PAID',
          paymentAllocations: createdAllocations.map((allocation) => ({
            ...allocation,
            payment: { status: paymentRecord.status },
          })),
        })),
        update: jest.fn(),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([{ id: 'payment-e2e-1' }]),
        findFirst: jest.fn().mockImplementation(() => Promise.resolve(paymentRecord)),
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(paymentRecord)),
        update: jest.fn().mockImplementation(
          ({ data }: { data: Record<string, unknown> }) => {
            paymentRecord = { ...paymentRecord, ...data };
            return Promise.resolve(paymentRecord);
          },
        ),
      },
      paymentAllocation: {
        create: jest.fn().mockImplementation(
          ({ data }: { data: { amount: number; chargeId: string } }) => {
            createdAllocations.push({ amount: data.amount });
            paymentRecord.paymentAllocations.push({
              ...data,
              charge: { currency: 'ARS', status: 'PAID' },
            });
            return Promise.resolve({ id: 'allocation-e2e-1', ...data });
          },
        ),
      },
      paymentAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'payment-audit-e2e-1' }),
      },
      processedWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'processed-e2e-1' }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      $transaction: jest.fn((callback: (client: unknown) => unknown) => callback(mockPrisma)),
    };
    mockIdempotencyService = {
      isProcessed: jest.fn(),
      markProcessed: jest.fn(),
      cacheProcessed: jest.fn(),
    };

    service = new PaymentGatewayService(
      mockProvider as any,
      mockPrisma,
      mockIdempotencyService,
      {
        convert: jest.fn().mockResolvedValue({
          functionalAmount: 10000,
          functionalCurrency: 'ARS',
          sourceExchangeRateId: null,
          appliedRate: '1',
          direction: 'IDENTITY',
          sourceEffectiveAt: null,
          conversionDate: new Date('2026-08-10T00:00:00.000Z'),
        }),
      },
    );
  });

  it('creates a payment preference and processes webhook to ledger evidence', async () => {
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

    // Step 2: Process webhook (charge PENDING + local SUBMITTED payment)
    mockIdempotencyService.isProcessed
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    mockIdempotencyService.markProcessed.mockResolvedValue(undefined);
    mockIdempotencyService.cacheProcessed.mockResolvedValue(undefined);

    const result = await service.processWebhookEvent(
      { action: 'payment.approved', data: { id: 'mock-evt-1' } },
      'mock-signature',
      'mercadopago',
    );

    // Step 3: Ledger evidence was produced
    expect(result.status).toBe('PAID');
    expect(result.chargeUpdated).toBe(true);
    expect(mockPrisma.paymentAllocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paymentId: 'payment-e2e-1', amount: 10000 }),
      }),
    );
    expect(mockPrisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'APPROVED', paymentEventId: 'mock-evt-1' }),
      }),
    );
    expect(mockPrisma.payment.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'payment-e2e-1' },
        data: expect.objectContaining({ status: 'RECONCILED' }),
      }),
    );
    expect(mockPrisma.paymentAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-e2e',
        paymentId: 'payment-e2e-1',
        action: 'RECONCILED',
      }),
    });
    expect(mockPrisma.paymentAuditLog.create).toHaveBeenCalledTimes(1);
    expect(mockIdempotencyService.isProcessed).toHaveBeenCalledWith('mock-evt-1', 'mercadopago');
    expect(mockIdempotencyService.cacheProcessed).toHaveBeenCalledWith('mock-evt-1', 'mercadopago');

    const replay = await service.processWebhookEvent(
      { action: 'payment.approved', data: { id: 'mock-evt-1' } },
      'mock-signature',
      'mercadopago',
    );

    expect(replay.chargeUpdated).toBe(false);
    expect(mockPrisma.paymentAuditLog.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.payment.update).toHaveBeenCalledTimes(2);
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
