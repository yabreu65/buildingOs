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
      isProcessed: jest.fn(),
      markProcessed: jest.fn(),
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
    });

    it('rejects charge on REJECTED webhook', async () => {
      const webhookEvent: WebhookEvent = {
        eventId: 'evt-2',
        eventType: 'payment.rejected',
        chargeId: 'charge-2',
        externalId: 'pay-2',
        status: 'REJECTED',
        rawPayload: {},
      };
      mockProvider.handleWebhook.mockResolvedValue(webhookEvent);
      mockPrisma.charge.findUnique.mockResolvedValue({ id: 'charge-2', status: 'PENDING' });
      mockPrisma.charge.update.mockResolvedValue({ id: 'charge-2', status: 'REJECTED' });
      mockIdempotencyService.isProcessed.mockResolvedValue(false);

      const result = await service.processWebhookEvent({}, { signature: 'sig' });

      expect(result.status).toBe('REJECTED');
      expect(mockIdempotencyService.isProcessed).toHaveBeenCalledWith('evt-2', 'mercadopago');
      expect(mockIdempotencyService.markProcessed).toHaveBeenCalledWith('evt-2', 'mercadopago');
      expect(mockPrisma.charge.update).toHaveBeenCalledWith({
        where: { id: 'charge-2' },
        data: { status: 'REJECTED', paymentExternalId: 'pay-2' },
      });
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
      expect(mockPrisma.charge.update).not.toHaveBeenCalled();
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
