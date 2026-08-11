/**
 * Tests for PaymentGatewayService — 3E1 ledger contract
 *
 * Financial rules under test:
 * - A charge is NEVER marked PAID directly: gateway events must produce
 *   Payment + PaymentAllocation ledger evidence and recalculated status.
 * - Missing/invalid provider amount or currency => no financial mutation.
 * - 3E1 is same-currency: event.currency must equal Charge.currency.
 * - Local Payment matched tenant-scoped by reference; absent Payment => no
 *   mutation (no invented actor).
 * - Replay is idempotent (IdempotencyService + unique payment/charge pair).
 */

import { PaymentGatewayService } from './payment-gateway.service';
import { PaymentProvider, WebhookEvent } from './interfaces/payment-provider.interface';
import { UnprocessableEntityException, ServiceUnavailableException } from '@nestjs/common';

describe('PaymentGatewayService (3E1 ledger)', () => {
  let service: PaymentGatewayService;
  let mockProvider: jest.Mocked<PaymentProvider>;
  let mockPrisma: any;
  let mockIdempotencyService: any;
  let mockConversion: any;
  let createdAllocations: Array<{ amount: number }>;
  let currentPayment: ReturnType<typeof payment>;

  const charge = (overrides: Record<string, unknown> = {}) => ({
    id: 'charge-1',
    tenantId: 'tenant-1',
    buildingId: 'building-1',
    unitId: 'unit-1',
    amount: 10000,
    currency: 'ARS',
    status: 'PENDING',
    paymentAllocations: [],
    ...overrides,
  });

  const payment = (overrides: Record<string, unknown> = {}) => ({
    id: 'payment-1',
    tenantId: 'tenant-1',
    buildingId: 'building-1',
    unitId: 'unit-1',
    amount: 10000,
    currency: 'ARS',
    status: 'SUBMITTED',
    reference: 'ext-1',
    paymentAllocations: [],
    ...overrides,
  });

  const paidEvent = (overrides: Partial<WebhookEvent> = {}): WebhookEvent => ({
    eventId: 'evt-1',
    eventType: 'payment.updated',
    chargeId: 'charge-1',
    externalId: 'ext-1',
    status: 'PAID',
    amount: 10000,
    currency: 'ARS',
    paidAt: '2026-08-10',
    rawPayload: {},
    ...overrides,
  });

  beforeEach(() => {
    createdAllocations = [];
    currentPayment = payment();
    mockProvider = {
      providerName: 'mercadopago',
      createPreference: jest.fn(),
      handleWebhook: jest.fn(),
      getChargeStatus: jest.fn(),
    };
    mockPrisma = {
      tenant: {
        findFirst: jest.fn().mockResolvedValue({ id: 'tenant-1', functionalCurrency: 'VES' }),
      },
      charge: {
        findFirst: jest.fn(() =>
          Promise.resolve(charge({
            paymentAllocations: createdAllocations.map((allocation) => ({
              ...allocation,
              payment: { id: 'other-payment', status: 'APPROVED' },
            })).concat(currentPayment.paymentAllocations.map((allocation) => ({
              ...allocation,
              payment: { id: currentPayment.id, status: currentPayment.status },
            }))),
          })),
        ),
        findUnique: jest.fn(() =>
          Promise.resolve(charge({
            paymentAllocations: createdAllocations.map((allocation) => ({
              ...allocation,
              payment: { id: 'other-payment', status: 'APPROVED' },
            })),
          })),
        ),
        update: jest.fn(),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([{ id: 'payment-1' }]),
        findFirst: jest.fn(() => Promise.resolve(currentPayment)),
        findUnique: jest.fn(() => Promise.resolve(currentPayment)),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          currentPayment = { ...currentPayment, ...data };
          return Promise.resolve(currentPayment);
        }),
      },
      paymentAllocation: {
        create: jest.fn(({ data }: { data: { amount: number } }) => {
          createdAllocations.push({ amount: data.amount });
          currentPayment = {
            ...currentPayment,
            paymentAllocations: [
              ...currentPayment.paymentAllocations,
              { ...data, charge: { currency: 'ARS', status: 'PAID' } },
            ],
          };
          return Promise.resolve({ id: 'alloc-1', ...data });
        }),
      },
      processedWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'processed-1' }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      $transaction: jest.fn((callback: (client: unknown) => unknown) => callback(mockPrisma)),
    };
    mockIdempotencyService = {
      isProcessed: jest.fn().mockResolvedValue(false),
      markProcessed: jest.fn().mockResolvedValue(undefined),
      cacheProcessed: jest.fn().mockResolvedValue(undefined),
    };
    mockConversion = {
      convert: jest.fn().mockResolvedValue({
        functionalAmount: 365000,
        functionalCurrency: 'VES',
        sourceExchangeRateId: 'rate-1',
        appliedRate: '36.5',
        direction: 'DIRECT',
        sourceEffectiveAt: new Date('2026-08-08T00:00:00.000Z'),
        conversionDate: new Date('2026-08-10T00:00:00.000Z'),
      }),
    };
    service = new PaymentGatewayService(
      mockProvider,
      mockPrisma,
      mockIdempotencyService,
      mockConversion,
    );
  });

  const completePaymentSnapshot = {
    functionalAmountMinor: 36500,
    functionalCurrencyCode: 'VES',
    exchangeRateId: 'rate-1',
    exchangeRateValue: '36.5',
    exchangeRateDirection: 'DIRECT',
    exchangeRateEffectiveAt: new Date('2026-08-08T00:00:00.000Z'),
    conversionDate: new Date('2026-08-10T00:00:00.000Z'),
  };

  const run = (event: WebhookEvent) => {
    mockProvider.handleWebhook.mockResolvedValue(event);
    return service.processWebhookEvent(event.rawPayload, 'sig', 'mercadopago');
  };

  describe('ledger evidence', () => {
    it('approves and reuses an existing SUBMITTED reservation without duplication', async () => {
      currentPayment = payment({
        paymentAllocations: [{
          chargeId: 'charge-1',
          amount: 10000,
          paymentOriginalAmountMinor: 10000,
          charge: { currency: 'ARS', status: 'PENDING' },
        }],
      });

      const result = await run(paidEvent());

      expect(result.chargeUpdated).toBe(true);
      expect(mockPrisma.paymentAllocation.create).not.toHaveBeenCalled();
      expect(mockPrisma.payment.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'APPROVED', paymentEventId: 'evt-1' }),
      }));
      expect(mockPrisma.processedWebhookEvent.create).toHaveBeenCalledTimes(1);
    });

    it('blocks an existing allocation amount mismatch without mutation or processed event', async () => {
      currentPayment = payment({
        paymentAllocations: [{
          chargeId: 'charge-1', amount: 9000, charge: { currency: 'ARS' },
        }],
      });

      await expect(run(paidEvent())).rejects.toMatchObject({
        response: { statusCode: 422, error: 'PAYMENT_PROVIDER_AMOUNT_MISMATCH' },
      });
      expect(mockPrisma.payment.update).not.toHaveBeenCalled();
      expect(mockPrisma.paymentAllocation.create).not.toHaveBeenCalled();
      expect(mockPrisma.processedWebhookEvent.create).not.toHaveBeenCalled();
    });

    it('creates PaymentAllocation and recalculates charge status (never direct PAID)', async () => {
      const result = await run(paidEvent());

      expect(result.chargeUpdated).toBe(true);
      expect(mockPrisma.paymentAllocation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentId: 'payment-1',
            chargeId: 'charge-1',
            amount: 10000,
            paymentOriginalAmountMinor: 10000,
          }),
        }),
      );
      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'APPROVED', paymentEventId: 'evt-1' }),
        }),
      );
      // Charge PAID status derives from allocations (recalc), never a direct mutation:
      const paidUpdate = (mockPrisma.charge.update as jest.Mock).mock.calls.find(
        (call) => call[0].data?.status === 'PAID',
      );
      expect(paidUpdate).toBeDefined();
      expect((mockPrisma.paymentAllocation.create as jest.Mock).mock.invocationCallOrder[0])
        .toBeLessThan((mockPrisma.charge.update as jest.Mock).mock.invocationCallOrder[0]);
      expect(mockIdempotencyService.cacheProcessed).toHaveBeenCalledWith('evt-1', 'mercadopago');
    });

    it('uses the real provider amount, never an inferred outstanding', async () => {
      await run(paidEvent());

      expect(mockPrisma.paymentAllocation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 10000 }),
        }),
      );
    });

    it('provider amount different from the local payment => 422 PAYMENT_PROVIDER_AMOUNT_MISMATCH, no mutation', async () => {
      await expect(run(paidEvent({ amount: 7500 }))).rejects.toMatchObject({
        response: { statusCode: 422, error: 'PAYMENT_PROVIDER_AMOUNT_MISMATCH' },
      });

      expect(mockPrisma.paymentAllocation.create).not.toHaveBeenCalled();
      expect(mockPrisma.charge.update).not.toHaveBeenCalled();
      expect(mockPrisma.payment.update).not.toHaveBeenCalled();
      expect(mockIdempotencyService.markProcessed).not.toHaveBeenCalled();
    });

    it('recalculates the charge to PAID from the allocation (ledger-derived status)', async () => {
      await run(paidEvent());

      const paidUpdate = (mockPrisma.charge.update as jest.Mock).mock.calls.find(
        (call) => call[0].data?.status === 'PAID',
      );
      expect(paidUpdate).toBeDefined();
    });

    it('skips allocation creation when the pair already exists (idempotent ledger)', async () => {
      currentPayment = payment({
          amount: 10000,
          status: 'APPROVED',
          paymentAllocations: [{ chargeId: 'charge-1', amount: 10000, charge: { currency: 'ARS' } }],
        });

      const result = await run(paidEvent());

      expect(result.chargeUpdated).toBe(true);
      expect(mockPrisma.paymentAllocation.create).not.toHaveBeenCalled();
      expect(mockIdempotencyService.cacheProcessed).toHaveBeenCalled();
    });
  });

  describe('missing financial evidence', () => {
    it.each([undefined, '', '   '])(
      'missing provider reference %p fails before any Payment query or mutation',
      async (externalId) => {
        await expect(run(paidEvent({ externalId }))).rejects.toMatchObject({
          response: { statusCode: 503, error: 'PAYMENT_PROVIDER_REFERENCE_REQUIRED' },
        });
        expect(mockPrisma.payment.findMany).not.toHaveBeenCalled();
        expect(mockPrisma.payment.findFirst).not.toHaveBeenCalled();
        expect(mockPrisma.payment.update).not.toHaveBeenCalled();
        expect(mockPrisma.paymentAllocation.create).not.toHaveBeenCalled();
        expect(mockPrisma.processedWebhookEvent.create).not.toHaveBeenCalled();
      },
    );

    it('uses the normalized provider reference for exact lookup', async () => {
      await run(paidEvent({ externalId: '  ext-1  ' }));
      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-1', reference: 'ext-1' }),
        take: 2,
      }));
    });

    it('fails closed when a tenant has multiple payments with the same reference', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([{ id: 'payment-1' }, { id: 'payment-2' }]);
      const result = await run(paidEvent());
      expect(result.chargeUpdated).toBe(false);
      expect(mockPrisma.payment.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.payment.update).not.toHaveBeenCalled();
      expect(mockPrisma.processedWebhookEvent.create).not.toHaveBeenCalled();
    });

    it('acknowledges a non-PAID event without requiring a provider reference', async () => {
      const result = await run(paidEvent({ status: 'PENDING', externalId: undefined }));
      expect(result.chargeUpdated).toBe(false);
      expect(mockPrisma.payment.findMany).not.toHaveBeenCalled();
    });

    it('missing provider amount => no financial mutation, event left unprocessed', async () => {
      await expect(run(paidEvent({ amount: undefined }))).rejects.toThrow(
        ServiceUnavailableException,
      );

      expect(mockPrisma.paymentAllocation.create).not.toHaveBeenCalled();
      expect(mockPrisma.charge.update).not.toHaveBeenCalled();
      expect(mockPrisma.payment.update).not.toHaveBeenCalled();
      expect(mockIdempotencyService.markProcessed).not.toHaveBeenCalled();
    });

    it('missing provider currency => no financial mutation', async () => {
      await expect(run(paidEvent({ currency: undefined }))).rejects.toThrow(
        ServiceUnavailableException,
      );

      expect(mockPrisma.paymentAllocation.create).not.toHaveBeenCalled();
      expect(mockPrisma.charge.update).not.toHaveBeenCalled();
      expect(mockIdempotencyService.markProcessed).not.toHaveBeenCalled();
    });

    it('non-canonical provider currency => no financial mutation', async () => {
      await expect(run(paidEvent({ currency: 'XYZ' }))).rejects.toThrow(
        ServiceUnavailableException,
      );

      expect(mockPrisma.paymentAllocation.create).not.toHaveBeenCalled();
      expect(mockIdempotencyService.markProcessed).not.toHaveBeenCalled();
    });
  });

  describe('same-currency invariant', () => {
    it('currency mismatch event vs charge => 422 PAYMENT_ALLOCATION_CURRENCY_NOT_SUPPORTED', async () => {
      mockPrisma.charge.findFirst.mockResolvedValue(charge({ currency: 'VES' }));

      await expect(run(paidEvent({ currency: 'ARS' }))).rejects.toMatchObject({
        response: { statusCode: 422, error: 'PAYMENT_ALLOCATION_CURRENCY_NOT_SUPPORTED' },
      });

      expect(mockPrisma.paymentAllocation.create).not.toHaveBeenCalled();
      expect(mockPrisma.charge.update).not.toHaveBeenCalled();
      expect(mockIdempotencyService.markProcessed).not.toHaveBeenCalled();
    });

    it('currency mismatch payment vs event => 422, no allocation', async () => {
      currentPayment = payment({ currency: 'VES' });

      await expect(run(paidEvent())).rejects.toMatchObject({
        response: { statusCode: 422, error: 'PAYMENT_ALLOCATION_CURRENCY_NOT_SUPPORTED' },
      });

      expect(mockPrisma.paymentAllocation.create).not.toHaveBeenCalled();
      expect(mockIdempotencyService.markProcessed).not.toHaveBeenCalled();
    });
  });

  describe('tenant isolation', () => {
    it('matches the local payment tenant-scoped by reference', async () => {
      await run(paidEvent());

      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
            reference: 'ext-1',
          }),
        }),
      );
    });

    it('no local payment => no mutation and event left unprocessed', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);

      const result = await run(paidEvent());

      expect(result.chargeUpdated).toBe(false);
      expect(mockPrisma.paymentAllocation.create).not.toHaveBeenCalled();
      expect(mockPrisma.charge.update).not.toHaveBeenCalled();
      expect(mockIdempotencyService.markProcessed).not.toHaveBeenCalled();
    });
  });

  describe('same-currency provider partial payment', () => {
    it('charge 10000, payment 4000, event 4000 => allocation 4000, charge PARTIAL, outstanding 6000', async () => {
      mockPrisma.charge.findFirst.mockImplementation(() =>
        Promise.resolve(charge({ amount: 10000, paymentAllocations: [...createdAllocations] })),
      );
      currentPayment = payment({ amount: 4000 });

      const result = await run(paidEvent({ amount: 4000 }));

      expect(result.chargeUpdated).toBe(true);
      expect(mockPrisma.paymentAllocation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 4000 }),
        }),
      );
      expect(mockPrisma.charge.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PARTIAL' }) }),
      );
      // ledger-derived outstanding
      expect(createdAllocations).toEqual([{ amount: 4000 }]);
    });

    it('replay of the partial event does not duplicate the allocation', async () => {
      mockPrisma.charge.findFirst.mockImplementation(() =>
        Promise.resolve(charge({ amount: 10000, paymentAllocations: [...createdAllocations] })),
      );
      currentPayment = payment({ amount: 4000 });

      await run(paidEvent({ amount: 4000 }));
      mockIdempotencyService.isProcessed.mockResolvedValue(true);
      await run(paidEvent({ amount: 4000 }));

      expect(mockPrisma.paymentAllocation.create).toHaveBeenCalledTimes(1);
      expect(createdAllocations).toEqual([{ amount: 4000 }]);
    });
  });

  describe('amount guards', () => {
    it('event amount above charge outstanding => 422, no mutation', async () => {
      createdAllocations.push({ amount: 8000 });
      currentPayment = payment({ amount: 3000 });

      await expect(run(paidEvent({ amount: 3000 }))).rejects.toMatchObject({
        response: { statusCode: 422, error: 'PAYMENT_EVENT_AMOUNT_EXCEEDS_OUTSTANDING' },
      });

      expect(mockPrisma.paymentAllocation.create).not.toHaveBeenCalled();
    });

    it('event amount above charge amount => 422, no mutation', async () => {
      mockPrisma.charge.findFirst.mockResolvedValue(charge({ amount: 5000 }));

      await expect(run(paidEvent({ amount: 7500 }))).rejects.toMatchObject({
        response: { statusCode: 422, error: 'PAYMENT_EVENT_AMOUNT_EXCEEDS_CHARGE' },
      });
    });
  });

  describe('3E2 gateway snapshot', () => {
    it('freezes a COMPLETE snapshot before the effective transition when the payment is SUBMITTED', async () => {
      const result = await run(paidEvent());

      expect(result.chargeUpdated).toBe(true);
      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'APPROVED',
            functionalAmountMinor: 365000,
            functionalCurrencyCode: 'VES',
            exchangeRateDirection: 'DIRECT',
          }),
        }),
      );
      expect(mockConversion.convert).toHaveBeenCalledWith(
        expect.objectContaining({ conversionDate: '2026-08-10' }),
        mockPrisma,
      );
    });

    it('missing provider economic date => no effective transition (ServiceUnavailable)', async () => {
      await expect(run(paidEvent({ paidAt: undefined }))).rejects.toThrow(
        ServiceUnavailableException,
      );

      expect(mockPrisma.payment.update).not.toHaveBeenCalled();
      expect(mockPrisma.paymentAllocation.create).not.toHaveBeenCalled();
      expect(mockIdempotencyService.markProcessed).not.toHaveBeenCalled();
    });

    it('missing rate => no effective transition and no markProcessed', async () => {
      mockConversion.convert.mockRejectedValue(
        new UnprocessableEntityException({
          statusCode: 422,
          error: 'EXCHANGE_RATE_NOT_FOUND',
          message: 'no rate',
        }),
      );

      await expect(run(paidEvent())).rejects.toThrow(UnprocessableEntityException);

      expect(mockPrisma.payment.update).not.toHaveBeenCalled();
      expect(mockPrisma.paymentAllocation.create).not.toHaveBeenCalled();
      expect(mockIdempotencyService.markProcessed).not.toHaveBeenCalled();
    });

    it('replay after a frozen snapshot never reconverts', async () => {
      await run(paidEvent());
      const convertCallsAfterFirst = mockConversion.convert.mock.calls.length;
      mockIdempotencyService.isProcessed.mockResolvedValue(true);
      await run(paidEvent());

      expect(mockConversion.convert.mock.calls.length).toBe(convertCallsAfterFirst);
      expect(mockPrisma.paymentAllocation.create).toHaveBeenCalledTimes(1);
    });

    it('an existing COMPLETE snapshot is reused exactly (no reconversion)', async () => {
      currentPayment = payment({ status: 'SUBMITTED', ...completePaymentSnapshot });

      const result = await run(paidEvent());

      expect(result.chargeUpdated).toBe(true);
      expect(mockConversion.convert).not.toHaveBeenCalled();
      expect(mockPrisma.payment.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ functionalAmountMinor: expect.anything() }),
        }),
      );
    });
  });

  describe('3E2 gateway paidAt economic date', () => {
    it('Payment.paidAt derives from the provider economic date (same day as conversionDate)', async () => {
      const result = await run(paidEvent());

      expect(result.chargeUpdated).toBe(true);
      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paidAt: new Date('2026-08-10T00:00:00.000Z'),
          }),
        }),
      );
      // conversionDate proviene del mismo event.paidAt (el convert mock recibe '2026-08-10')
      expect(mockConversion.convert).toHaveBeenCalledWith(
        expect.objectContaining({ conversionDate: '2026-08-10' }),
        mockPrisma,
      );
    });

    it('midnight boundary: a late-day provider date never shifts to the processing day', async () => {
      const result = await run(paidEvent({ paidAt: '2026-08-10' }));

      expect(result.chargeUpdated).toBe(true);
      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paidAt: new Date('2026-08-10T00:00:00.000Z'),
          }),
        }),
      );
    });
  });

  describe('idempotency / replay', () => {
    it('skips processing when the event was already processed', async () => {
      mockIdempotencyService.isProcessed.mockResolvedValue(true);

      const result = await run(paidEvent());

      expect(result.chargeUpdated).toBe(false);
      expect(mockPrisma.paymentAllocation.create).not.toHaveBeenCalled();
      expect(mockIdempotencyService.markProcessed).not.toHaveBeenCalled();
    });

    it('duplicate event cannot duplicate the allocation (unique payment/charge pair)', async () => {
      await run(paidEvent());
      mockIdempotencyService.isProcessed.mockResolvedValue(true);
      await run(paidEvent());

      expect(mockPrisma.paymentAllocation.create).toHaveBeenCalledTimes(1);
    });
  });
});
