/**
 * Tests for PaymentWebhookController
 * Task 2.7: POST /webhooks/payment endpoint
 * Fix 2: Verify SignatureGuard is applied
 * Fix 3: Verify HTTP 503 when webhooks are disabled
 */

import { PaymentWebhookController } from './payment-webhook.controller';
import { SignatureGuard } from './signature.guard';
import { BadRequestException, HttpException, INestApplication, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'http';
import { PaymentGatewayService } from '../payment-gateway.service';
import { ConfigService } from '../../../config/config.service';

describe('PaymentWebhookController', () => {
  let controller: PaymentWebhookController;
  let mockGatewayService: {
    processWebhookEvent: jest.Mock;
    getActiveProviderName: jest.Mock;
  };
  let mockConfigService: {
    getValue: jest.Mock;
  };

  beforeEach(() => {
    mockGatewayService = {
      processWebhookEvent: jest.fn(),
      getActiveProviderName: jest.fn().mockReturnValue('mercadopago'),
    };
    mockConfigService = {
      getValue: jest.fn(),
    };
    controller = new PaymentWebhookController(
      mockGatewayService as unknown as PaymentGatewayService,
      mockConfigService as unknown as ConfigService,
    );
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

    it('throws HttpException with status 503 when no active provider is configured', async () => {
      mockConfigService.getValue.mockReturnValue(true);
      mockGatewayService.getActiveProviderName.mockReturnValue(null);

      await expect(
        controller.handleWebhook({}, 'sig', 'mercadopago'),
      ).rejects.toMatchObject({ status: 503 });

      expect(mockGatewayService.processWebhookEvent).not.toHaveBeenCalled();
    });

    it('uses the active configured provider when x-provider is missing', async () => {
      mockConfigService.getValue.mockReturnValue(true);
      mockGatewayService.getActiveProviderName.mockReturnValue('stripe');
      mockGatewayService.processWebhookEvent.mockResolvedValue({
        eventId: 'evt-1',
        eventType: 'checkout.session.completed',
        status: 'PAID',
        chargeUpdated: true,
      });

      const result = await controller.handleWebhook({ data: { id: 'pay-1' } }, 'sig', undefined, 'request-1', 'pay-1');

      expect(result).toEqual({
        status: 'PAID',
        message: 'Webhook processed successfully',
      });
      expect(mockGatewayService.processWebhookEvent).toHaveBeenCalledWith(
        { data: { id: 'pay-1' } },
        { signature: 'sig', requestId: 'request-1', dataId: 'pay-1', provider: 'stripe' },
        'stripe',
      );
    });

    it('processes webhook when x-provider matches the active provider', async () => {
      mockConfigService.getValue.mockReturnValue(true);
      mockGatewayService.processWebhookEvent.mockResolvedValue({
        eventId: 'evt-1',
        eventType: 'payment.approved',
        status: 'PAID',
        chargeUpdated: true,
      });

      const result = await controller.handleWebhook({ data: { id: 'pay-1' } }, 'sig', 'mercadopago', 'request-1', 'pay-1');

      expect(result.status).toBe('PAID');
      expect(mockGatewayService.processWebhookEvent).toHaveBeenCalledWith(
        { data: { id: 'pay-1' } },
        { signature: 'sig', requestId: 'request-1', dataId: 'pay-1', provider: 'mercadopago' },
        'mercadopago',
      );
    });

    it('passes x-request-id and query data.id into the signature context', async () => {
      mockConfigService.getValue.mockReturnValue(true);
      mockGatewayService.processWebhookEvent.mockResolvedValue({
        eventId: 'evt-1',
        eventType: 'payment.approved',
        status: 'PAID',
        chargeUpdated: true,
      });

      await controller.handleWebhook(
        { action: 'payment.updated' },
        'ts=1678886400,v1=signature',
        ['mercadopago'],
        ['request-123'],
        ['payment-123'],
      );

      expect(mockGatewayService.processWebhookEvent).toHaveBeenCalledWith(
        { action: 'payment.updated' },
        {
          signature: 'ts=1678886400,v1=signature',
          requestId: 'request-123',
          dataId: 'payment-123',
          provider: 'mercadopago',
        },
        'mercadopago',
      );
    });

    it('rejects mismatched x-provider before service processing', async () => {
      mockConfigService.getValue.mockReturnValue(true);
      mockGatewayService.getActiveProviderName.mockReturnValue('mercadopago');

      await expect(
        controller.handleWebhook({ data: { id: 'pay-1' } }, 'sig', 'stripe'),
      ).rejects.toMatchObject({ status: 400 });

      expect(mockGatewayService.processWebhookEvent).not.toHaveBeenCalled();
    });

    it.each([
      [new BadRequestException('Invalid webhook payload'), 400],
      [new UnauthorizedException('Invalid webhook signature'), 401],
    ])('propagates service HttpException errors from webhook processing', async (exception, status) => {
      mockConfigService.getValue.mockReturnValue(true);
      mockGatewayService.processWebhookEvent.mockRejectedValue(exception);

      await expect(
        controller.handleWebhook({ data: { id: 'pay-1' } }, 'sig', 'mercadopago', 'request-1', 'pay-1'),
      ).rejects.toMatchObject({ status });
    });

    it('converts unexpected webhook processing failures to HTTP 500', async () => {
      mockConfigService.getValue.mockReturnValue(true);
      mockGatewayService.processWebhookEvent.mockRejectedValue(new Error('database timeout'));

      await expect(
        controller.handleWebhook({ data: { id: 'pay-1' } }, 'sig', 'mercadopago', 'request-1', 'pay-1'),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('HTTP binding', () => {
    let app: INestApplication;
    let httpServer: Server;

    afterEach(async () => {
      await app?.close();
    });

    const createApp = async (gatewayService: {
      processWebhookEvent: jest.Mock;
      getActiveProviderName: jest.Mock;
    }, configService: { getValue: jest.Mock }): Promise<void> => {
      const moduleRef = await Test.createTestingModule({
        controllers: [PaymentWebhookController],
        providers: [
          { provide: PaymentGatewayService, useValue: gatewayService },
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      await app.init();
      httpServer = app.getHttpServer() as Server;
    };

    it('binds x-signature, x-request-id, and query data.id into the service signature context', async () => {
      const gatewayService = {
        processWebhookEvent: jest.fn().mockResolvedValue({
          eventId: 'evt-http-1',
          eventType: 'payment.approved',
          rawPayload: { action: 'payment.updated' },
          status: 'PAID',
          chargeUpdated: true,
        }),
        getActiveProviderName: jest.fn().mockReturnValue('mercadopago'),
      };
      const configService = {
        getValue: jest.fn().mockReturnValue(true),
      };
      await createApp(gatewayService, configService);

      await request(httpServer)
        .post('/webhooks/payment')
        .query({ 'data.id': 'payment-123' })
        .set('x-signature', 'ts=1678886400,v1=signature')
        .set('x-request-id', 'request-123')
        .send({ action: 'payment.updated' })
        .expect(200);

      expect(gatewayService.processWebhookEvent).toHaveBeenCalledWith(
        { action: 'payment.updated' },
        {
          signature: 'ts=1678886400,v1=signature',
          requestId: 'request-123',
          dataId: 'payment-123',
          provider: 'mercadopago',
        },
        'mercadopago',
      );
    });

    it('returns the success body with HTTP 200 on successful webhook processing', async () => {
      const gatewayService = {
        processWebhookEvent: jest.fn().mockResolvedValue({
          eventId: 'evt-http-2',
          eventType: 'payment.approved',
          rawPayload: { action: 'payment.updated' },
          status: 'PAID',
          chargeUpdated: true,
        }),
        getActiveProviderName: jest.fn().mockReturnValue('mercadopago'),
      };
      const configService = {
        getValue: jest.fn().mockReturnValue(true),
      };
      await createApp(gatewayService, configService);

      await request(httpServer)
        .post('/webhooks/payment')
        .query({ 'data.id': 'payment-123' })
        .set('x-signature', 'ts=1678886400,v1=signature')
        .set('x-request-id', 'request-123')
        .send({ action: 'payment.updated' })
        .expect(200)
        .expect({
          status: 'PAID',
          message: 'Webhook processed successfully',
        });
    });

    it('returns the service HttpException status instead of HTTP 200 error body', async () => {
      const gatewayService = {
        processWebhookEvent: jest.fn().mockRejectedValue(new UnauthorizedException('Invalid webhook signature')),
        getActiveProviderName: jest.fn().mockReturnValue('mercadopago'),
      };
      const configService = {
        getValue: jest.fn().mockReturnValue(true),
      };
      await createApp(gatewayService, configService);

      await request(httpServer)
        .post('/webhooks/payment')
        .query({ 'data.id': 'payment-123' })
        .set('x-signature', 'ts=1678886400,v1=bad')
        .set('x-request-id', 'request-123')
        .send({ action: 'payment.updated' })
        .expect(401);
    });

    it('returns HTTP 500 instead of HTTP 200 error body for unexpected processing failures', async () => {
      const gatewayService = {
        processWebhookEvent: jest.fn().mockRejectedValue(new Error('database timeout')),
        getActiveProviderName: jest.fn().mockReturnValue('mercadopago'),
      };
      const configService = {
        getValue: jest.fn().mockReturnValue(true),
      };
      await createApp(gatewayService, configService);

      await request(httpServer)
        .post('/webhooks/payment')
        .query({ 'data.id': 'payment-123' })
        .set('x-signature', 'ts=1678886400,v1=signature')
        .set('x-request-id', 'request-123')
        .send({ action: 'payment.updated' })
        .expect(500);
    });
  });
});
