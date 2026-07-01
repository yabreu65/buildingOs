/**
 * Tests for PaymentGatewayService
 * Task 2.3: Delegates to active adapter, confirmCharge on webhook
 * Fix 4: Uses IdempotencyService instead of inline Redis/Prisma checks
 */

import { PaymentGatewayService } from './payment-gateway.service';
import { PaymentProvider, PaymentPreference, WebhookEvent, PaymentStatus } from './interfaces/payment-provider.interface';
import { HttpException } from '@nestjs/common';

describe('PaymentGatewayService', () => {
  let service: PaymentGatewayService;
  let mockProvider: jest.Mocked<PaymentProvider>;
  let mockPrisma: any;
  let mockIdempotencyService: any;

  beforeEach(() => {
    mockProvider = {
      providerName: 'mercadopago',
      createPreference: jest.fn(),
      handleWebhook: jest.fn(),
      getChargeStatus: jest.fn(),
    };
    mockPrisma = {
      charge: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      payment: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    mockIdempotencyService = {
      isProcessed: jest.fn().mockResolvedValue(false),
      markProcessed: jest.fn().mockResolvedValue(undefined),
    };
    service = new PaymentGatewayService(mockProvider, mockPrisma, mockIdempotencyService);
  });

  describe('createPreference', () => {
    it('delegates to the active provider', async () => {
      const mockPreference: PaymentPreference = {
        preferenceId: 'pref-1',
        checkoutUrl: 'https://pay.example.com/1',
        provider: 'mercadopago',
      };
      mockProvider.createPreference.mockResolvedValue(mockPreference);

      const result = await service.createPreference({
        chargeId: 'charge-1',
        tenantId: 'tenant-1',
        amount: 10000,
        currency: 'ARS',
        concept: 'Test',
      });

      expect(result).toEqual(mockPreference);
      expect(mockProvider.createPreference).toHaveBeenCalledTimes(1);
    });
  });

  describe('processWebhookEvent', () => {
    it('exposes the active configured provider', () => {
      expect(service.getActiveProviderName()).toBe('mercadopago');
    });

    it('delegates to the provider and confirms charge on PAID', async () => {
      const webhookEvent: WebhookEvent = {
        eventId: 'evt-1',
        eventType: 'payment.approved',
        chargeId: 'charge-1',
        externalId: 'pay-1',
        status: 'PAID',
        rawPayload: {},
      };
      mockProvider.handleWebhook.mockResolvedValue(webhookEvent);
      mockPrisma.charge.findUnique.mockResolvedValue({ id: 'charge-1', status: 'PENDING' });
      mockPrisma.charge.update.mockResolvedValue({ id: 'charge-1', status: 'PAID' });
      mockPrisma.payment.findFirst.mockResolvedValue(null);
      mockPrisma.payment.update.mockResolvedValue({ id: 'pay-1', paymentEventId: 'evt-1' });
      mockIdempotencyService.isProcessed.mockResolvedValue(false);

      const signatureContext = { signature: 'sig', requestId: 'req-1', dataId: 'pay-1' };

      const result = await service.processWebhookEvent({}, signatureContext, 'mercadopago');

      expect(result.status).toBe('PAID');
      expect(mockProvider.handleWebhook).toHaveBeenCalledWith(
        {},
        'sig',
        { ...signatureContext, provider: 'mercadopago' },
      );
      expect(mockIdempotencyService.isProcessed).toHaveBeenCalledWith('evt-1', 'mercadopago');
      expect(mockIdempotencyService.markProcessed).toHaveBeenCalledWith('evt-1', 'mercadopago');
      expect(mockPrisma.charge.update).toHaveBeenCalledWith({
        where: { id: 'charge-1' },
        data: { status: 'PAID', paymentExternalId: 'pay-1' },
      });
      expect(mockIdempotencyService.markProcessed.mock.invocationCallOrder[0]).toBeGreaterThan(
        mockPrisma.charge.update.mock.invocationCallOrder[0],
      );
    });

    it('processes PAID after an ignored PENDING webhook with the same MercadoPago payment id', async () => {
      mockProvider.handleWebhook
        .mockResolvedValueOnce({
          eventId: 'mp-payment-1',
          eventType: 'payment.pending',
          chargeId: 'charge-1',
          externalId: 'mp-payment-1',
          status: 'PENDING',
          rawPayload: {},
        })
        .mockResolvedValueOnce({
          eventId: 'mp-payment-1',
          eventType: 'payment.approved',
          chargeId: 'charge-1',
          externalId: 'mp-payment-1',
          status: 'PAID',
          rawPayload: {},
        });
      mockPrisma.charge.findUnique.mockResolvedValue({ id: 'charge-1', status: 'PENDING' });
      mockPrisma.charge.update.mockResolvedValue({ id: 'charge-1', status: 'PAID' });
      mockPrisma.payment.findFirst.mockResolvedValue(null);

      const pendingResult = await service.processWebhookEvent({}, { signature: 'sig' }, 'mercadopago');
      const paidResult = await service.processWebhookEvent({}, { signature: 'sig' }, 'mercadopago');

      expect(pendingResult.chargeUpdated).toBe(false);
      expect(paidResult.chargeUpdated).toBe(true);
      expect(mockIdempotencyService.isProcessed).toHaveBeenCalledTimes(1);
      expect(mockIdempotencyService.isProcessed).toHaveBeenCalledWith('mp-payment-1', 'mercadopago');
      expect(mockIdempotencyService.markProcessed).toHaveBeenCalledTimes(1);
      expect(mockIdempotencyService.markProcessed).toHaveBeenCalledWith('mp-payment-1', 'mercadopago');
      expect(mockPrisma.charge.update).toHaveBeenCalledWith({
        where: { id: 'charge-1' },
        data: { status: 'PAID', paymentExternalId: 'mp-payment-1' },
      });
    });

    it.each(['REJECTED', 'CANCELLED', 'PENDING'] as const)(
      'acknowledges %s without charge updates or processed markers',
      async (status) => {
        const webhookEvent: WebhookEvent = {
          eventId: `evt-${status.toLowerCase()}`,
          eventType: `payment.${status.toLowerCase()}`,
          chargeId: 'charge-2',
          externalId: 'pay-2',
          status,
          rawPayload: {},
        };
        mockProvider.handleWebhook.mockResolvedValue(webhookEvent);

        const result = await service.processWebhookEvent({}, { signature: 'sig' });

        expect(result).toMatchObject({ status, chargeUpdated: false });
        expect(mockIdempotencyService.isProcessed).not.toHaveBeenCalled();
        expect(mockIdempotencyService.markProcessed).not.toHaveBeenCalled();
        expect(mockPrisma.charge.findUnique).not.toHaveBeenCalled();
        expect(mockPrisma.charge.update).not.toHaveBeenCalled();
        expect(mockPrisma.payment.update).not.toHaveBeenCalled();
      },
    );

    it('does not mark PAID as processed when the charge update fails', async () => {
      const webhookEvent: WebhookEvent = {
        eventId: 'evt-paid-fail',
        eventType: 'payment.approved',
        chargeId: 'charge-fail',
        externalId: 'pay-fail',
        status: 'PAID',
        rawPayload: {},
      };
      mockProvider.handleWebhook.mockResolvedValue(webhookEvent);
      mockPrisma.charge.findUnique.mockResolvedValue({ id: 'charge-fail', status: 'PENDING' });
      mockPrisma.charge.update.mockRejectedValue(new Error('database timeout'));

      await expect(service.processWebhookEvent({}, { signature: 'sig' })).rejects.toThrow('database timeout');

      expect(mockIdempotencyService.isProcessed).toHaveBeenCalledWith('evt-paid-fail', 'mercadopago');
      expect(mockIdempotencyService.markProcessed).not.toHaveBeenCalled();
    });

    it('skips processing for duplicate webhook events', async () => {
      const webhookEvent: WebhookEvent = {
        eventId: 'evt-dup',
        eventType: 'payment.approved',
        chargeId: 'charge-3',
        externalId: 'pay-3',
        status: 'PAID',
        rawPayload: {},
      };
      mockProvider.handleWebhook.mockResolvedValue(webhookEvent);
      mockIdempotencyService.isProcessed.mockResolvedValue(true);

      const result = await service.processWebhookEvent({}, { signature: 'sig' }, 'mercadopago');

      expect(result.chargeUpdated).toBe(false);
      expect(mockIdempotencyService.isProcessed).toHaveBeenCalledWith('evt-dup', 'mercadopago');
      expect(mockIdempotencyService.markProcessed).not.toHaveBeenCalled();
      expect(mockPrisma.charge.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.charge.update).not.toHaveBeenCalled();
      expect(mockPrisma.payment.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.payment.update).not.toHaveBeenCalled();
    });

    it('marks successful PAID events after charge and payment side effects', async () => {
      const webhookEvent: WebhookEvent = {
        eventId: 'evt-paid-side-effects',
        eventType: 'payment.approved',
        chargeId: 'charge-side-effects',
        externalId: 'pay-side-effects',
        status: 'PAID',
        rawPayload: {},
      };
      mockProvider.handleWebhook.mockResolvedValue(webhookEvent);
      mockPrisma.charge.findUnique.mockResolvedValue({ id: 'charge-side-effects', status: 'PENDING' });
      mockPrisma.charge.update.mockResolvedValue({ id: 'charge-side-effects', status: 'PAID' });
      mockPrisma.payment.findFirst.mockResolvedValue({ id: 'payment-1' });
      mockPrisma.payment.update.mockResolvedValue({ id: 'payment-1', paymentEventId: 'evt-paid-side-effects' });

      await service.processWebhookEvent({}, { signature: 'sig' });

      expect(mockIdempotencyService.markProcessed).toHaveBeenCalledWith('evt-paid-side-effects', 'mercadopago');
      expect(mockIdempotencyService.markProcessed.mock.invocationCallOrder[0]).toBeGreaterThan(
        mockPrisma.charge.update.mock.invocationCallOrder[0],
      );
      expect(mockIdempotencyService.markProcessed.mock.invocationCallOrder[0]).toBeGreaterThan(
        mockPrisma.payment.update.mock.invocationCallOrder[0],
      );
    });

    it('rejects direct webhook processing when requested provider conflicts with active provider', async () => {
      await expect(service.processWebhookEvent({}, { signature: 'sig' }, 'stripe')).rejects.toThrow(
        'Webhook provider mismatch: active provider is mercadopago',
      );

      expect(mockProvider.handleWebhook).not.toHaveBeenCalled();
      expect(mockIdempotencyService.isProcessed).not.toHaveBeenCalled();
    });

    it('rejects direct webhook processing with HTTP 400 when requested provider conflicts with active provider', async () => {
      await expect(service.processWebhookEvent({}, { signature: 'sig' }, 'stripe')).rejects.toMatchObject({ status: 400 });
    });

    it('rejects direct webhook processing with HTTP 503 when no provider is configured', async () => {
      const serviceWithoutProvider = new PaymentGatewayService(null, mockPrisma, mockIdempotencyService);

      await expect(serviceWithoutProvider.processWebhookEvent({}, { signature: 'sig' })).rejects.toBeInstanceOf(HttpException);
      await expect(serviceWithoutProvider.processWebhookEvent({}, { signature: 'sig' })).rejects.toMatchObject({ status: 503 });
    });
  });

  describe('getChargeStatus', () => {
    it('delegates to the provider', async () => {
      mockProvider.getChargeStatus.mockResolvedValue('PAID');

      const status = await service.getChargeStatus('pay-1');
      expect(status).toBe('PAID');
      expect(mockProvider.getChargeStatus).toHaveBeenCalledWith('pay-1');
    });
  });
});
