/**
 * Payment Gateway Resolver — reads PAYMENT_PROVIDER from environment.
 * Safe: defaults to 'none', validates required credentials, never logs secrets.
 * Exported so wiring logic can be tested independently of NestJS module loading.
 */

import { PaymentGatewayOptions } from './payment-gateway.module';

export interface ResolvedPaymentGateway {
  provider: 'none' | 'mercadopago' | 'stripe';
  options: PaymentGatewayOptions;
}

export function resolvePaymentGateway(env: NodeJS.ProcessEnv = process.env): ResolvedPaymentGateway {
  const provider = (env.PAYMENT_PROVIDER || 'none') as 'none' | 'mercadopago' | 'stripe';
  const options: PaymentGatewayOptions = {};

  if (provider === 'none') {
    return { provider, options };
  }

  if (provider === 'mercadopago') {
    if (!env.MERCADOPAGO_ACCESS_TOKEN) {
      throw new Error(
        'MERCADOPAGO_ACCESS_TOKEN is required when PAYMENT_PROVIDER=mercadopago. ' +
        'Set the env var or switch to PAYMENT_PROVIDER=none.',
      );
    }
    options.mercadopagoAccessToken = env.MERCADOPAGO_ACCESS_TOKEN;
    return { provider, options };
  }

  if (provider === 'stripe') {
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error(
        'STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe. ' +
        'Set the env var or switch to PAYMENT_PROVIDER=none.',
      );
    }
    options.stripeSecretKey = env.STRIPE_SECRET_KEY;
    return { provider, options };
  }

  return { provider, options };
}
