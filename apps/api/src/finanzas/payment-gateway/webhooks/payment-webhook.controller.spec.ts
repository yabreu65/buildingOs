/**
 * Tests for PaymentWebhookController
 * Task 2.7: POST /webhooks/payment endpoint
 * Fix 2: Verify SignatureGuard is applied
 * Fix 3: Verify HTTP 503 when webhooks are disabled
 */

import { PaymentWebhookController } from './payment-webhook.controller';
import { SignatureGuard } from './signature.guard';
import { UseGuards } from '@nestjs/common';
import { HttpException } from '@nestjs/common';

describe('PaymentWebhookController', () => {
  let controller: PaymentWebhookController;
  let mockGatewayService: any;
  let mockConfigService: any;

  beforeEach(() => {
    mockGatewayService = {
      processWebhookEvent: jest.fn(),
    };
    mockConfigService = {
      getValue: jest.fn(),
    };
    controller = new PaymentWebhookController(mockGatewayService, mockConfigService);
  });

  describe('SignatureGuard application', () => {
    it('should have @UseGuards(SignatureGuard) decorator on the controller', () => {
      // Fix 2: Verify the controller uses SignatureGuard
      const guards = Reflect.getMetadata('__guards__', PaymentWebhookController) || [];
      expect(guards).toContain(SignatureGuard);
    });
  });

  describe('handleWebhook', () => {
    it('throws HttpException with status 503 when webhooks are disabled', async () => {
      // Fix 3: The controller must throw an HttpException with 503, not return 200 with body field
      mockConfigService.getValue.mockReturnValue(false);

      await expect(
        controller.handleWebhook({}, 'sig', 'mercadopago'),
      ).rejects.toThrow();

      try {
        await controller.handleWebhook({}, 'sig', 'mercadopago');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(503);
      }
    });

    it('processes webhook when webhooks are enabled', async () => {
      mockConfigService.getValue.mockReturnValue(true);
      mockGatewayService.processWebhookEvent.mockResolvedValue({
        eventId: 'evt-1',
        eventType: 'payment.approved',
        status: 'PAID',
        chargeUpdated: true,
      });

      const result = await controller.handleWebhook({ data: { id: 'pay-1' } }, 'sig', 'mercadopago');

      expect(result.status).toBe('PAID');
      expect(mockGatewayService.processWebhookEvent).toHaveBeenCalled();
    });
  });
});