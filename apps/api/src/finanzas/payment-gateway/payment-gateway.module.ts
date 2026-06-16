/**
 * PaymentGatewayModule — DynamicModule for payment provider selection
 * Task 2.4: Registers the active provider adapter at startup based on PAYMENT_PROVIDER env var
 */

import { DynamicModule, Module, Provider } from '@nestjs/common';
import { PaymentGatewayService } from './payment-gateway.service';
import { PAYMENT_PROVIDER_TOKEN } from './interfaces/payment-provider.interface';
import { MercadoPagoAdapter } from './adapters/mercadopago.adapter';
import { StripeAdapter } from './adapters/stripe.adapter';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { IdempotencyService } from './webhooks/idempotency.service';
import { PaymentProvider } from './interfaces/payment-provider.interface';

export interface PaymentGatewayOptions {
  mercadopagoAccessToken?: string;
  stripeSecretKey?: string;
}

@Module({})
export class PaymentGatewayModule {
  /**
   * Register the payment gateway module with the specified provider
   * Uses the PAYMENT_PROVIDER config value to select the adapter
   */
  static register(providerName: 'none' | 'mercadopago' | 'stripe', options: PaymentGatewayOptions): DynamicModule {
    if (providerName === 'none') {
      return {
        module: PaymentGatewayModule,
        imports: [PrismaModule, RedisModule],
        providers: [],
        exports: [],
      };
    }

    const providerFactory: Provider<PaymentProvider> = {
      provide: PAYMENT_PROVIDER_TOKEN,
      useFactory: () => {
        switch (providerName) {
          case 'mercadopago':
            return new MercadoPagoAdapter(options.mercadopagoAccessToken || '');
          case 'stripe':
            return new StripeAdapter(options.stripeSecretKey || '');
          default:
            throw new Error(`Unknown payment provider: ${providerName}`);
        }
      },
    };

    return {
      module: PaymentGatewayModule,
      imports: [PrismaModule, RedisModule],
      providers: [providerFactory, IdempotencyService, PaymentGatewayService],
      exports: [PAYMENT_PROVIDER_TOKEN, PaymentGatewayService],
    };
  }
}