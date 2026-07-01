/**
 * PaymentWebhookController — handles POST /webhooks/payment
 * Task 2.7: Processes payment webhooks; returns 503 when webhooks disabled
 */

import { BadRequestException, Controller, Post, Body, Headers, HttpCode, HttpStatus, Logger, UseGuards, HttpException, Query } from '@nestjs/common';
import { PaymentGatewayService } from '../payment-gateway.service';
import { ConfigService } from '../../../config/config.service';
import { SignatureGuard } from './signature.guard';
import { PaymentProviderName } from '../interfaces/payment-provider.interface';

@Controller('webhooks/payment')
@UseGuards(SignatureGuard)
export class PaymentWebhookController {
  private readonly logger = new Logger(PaymentWebhookController.name);

  constructor(
    private readonly gatewayService: PaymentGatewayService,
    private readonly configService: ConfigService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() payload: unknown,
    @Headers('x-signature') signature: string | string[],
    @Headers('x-provider') providerHeader?: string | string[],
    @Headers('x-request-id') requestId?: string | string[],
    @Query('data.id') dataId?: string | string[],
  ): Promise<{ status: string; message?: string }> {
    const webhooksEnabled = this.configService.getValue('enablePaymentWebhooks');

    if (!webhooksEnabled) {
      this.logger.warn('Payment webhook received but webhooks are disabled');
      throw new HttpException('Payment webhooks are not enabled', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const activeProvider = this.gatewayService.getActiveProviderName();
    if (!activeProvider) {
      throw new HttpException('Payment provider is not configured', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const requestedProvider = this.normalizeProviderHeader(providerHeader);
    if (requestedProvider && requestedProvider !== activeProvider) {
      throw new BadRequestException('Webhook provider does not match the active payment provider');
    }

    try {
      const result = await this.gatewayService.processWebhookEvent(
        payload,
        {
          signature: this.normalizeHeaderValue(signature),
          requestId: this.normalizeHeaderValue(requestId),
          dataId: this.normalizeHeaderValue(dataId),
          provider: activeProvider,
        },
        activeProvider,
      );

      this.logger.log(`Webhook processed: event=${result.eventId} status=${result.status}`);
      return {
        status: result.status,
        message: 'Webhook processed successfully',
      };
    } catch (error) {
      this.logger.error(`Webhook processing failed: ${error instanceof Error ? error.message : String(error)}`);
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Internal error',
      };
    }
  }

  private normalizeProviderHeader(providerHeader?: string | string[]): PaymentProviderName | string | undefined {
    const normalized = this.normalizeHeaderValue(providerHeader);

    return normalized === '' ? undefined : normalized;
  }

  private normalizeHeaderValue(value?: string | string[]): string | undefined {
    const headerValue = Array.isArray(value) ? value[0] : value;
    const normalized = headerValue?.trim();

    return normalized === '' ? undefined : normalized;
  }
}
