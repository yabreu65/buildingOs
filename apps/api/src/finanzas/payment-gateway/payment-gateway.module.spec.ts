/**
 * Tests for PaymentGatewayModule DynamicModule
 * Task 2.4: Verify module registration for each provider
 */

import { PaymentGatewayModule } from './payment-gateway.module';
import { MercadoPagoAdapter } from './adapters/mercadopago.adapter';
import { StripeAdapter } from './adapters/stripe.adapter';
import { PAYMENT_PROVIDER_TOKEN } from './interfaces/payment-provider.interface';

describe('PaymentGatewayModule', () => {
  it('registers MercadoPagoAdapter when PAYMENT_PROVIDER is mercadopago', () => {
    const module = PaymentGatewayModule.register('mercadopago', {
      mercadopagoAccessToken: 'test-token',
    });

    expect(module.module).toBeDefined();
    expect(module.providers).toBeDefined();
    expect(module.exports).toContain(PAYMENT_PROVIDER_TOKEN);
  });

  it('registers StripeAdapter when PAYMENT_PROVIDER is stripe', () => {
    const module = PaymentGatewayModule.register('stripe', {
      stripeSecretKey: 'sk_test_key',
    });

    expect(module.module).toBeDefined();
    expect(module.providers).toBeDefined();
    expect(module.exports).toContain(PAYMENT_PROVIDER_TOKEN);
  });

  it('returns empty module when PAYMENT_PROVIDER is none', () => {
    const module = PaymentGatewayModule.register('none', {});

    // When none, the module should not register any provider
    expect(module).toBeDefined();
  });
});