/**
 * Tests for Payment Gateway Resolver
 * Verifies: default=none, reads env vars, missing creds fail with clear error
 */

import { resolvePaymentGateway } from './payment-gateway.resolver';

describe('resolvePaymentGateway', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.PAYMENT_PROVIDER;
    delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    delete process.env.STRIPE_SECRET_KEY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('default behavior', () => {
    it('returns provider=none when PAYMENT_PROVIDER is not set', () => {
      const result = resolvePaymentGateway({});
      expect(result.provider).toBe('none');
      expect(result.options).toEqual({});
    });

    it('returns provider=none when PAYMENT_PROVIDER is empty string', () => {
      const result = resolvePaymentGateway({ PAYMENT_PROVIDER: '' });
      expect(result.provider).toBe('none');
    });
  });

  describe('mercadopago provider', () => {
    it('reads MERCADOPAGO_ACCESS_TOKEN from env', () => {
      const result = resolvePaymentGateway({
        PAYMENT_PROVIDER: 'mercadopago',
        MERCADOPAGO_ACCESS_TOKEN: 'TEST-123',
      });
      expect(result.provider).toBe('mercadopago');
      expect(result.options.mercadopagoAccessToken).toBe('TEST-123');
    });

    it('fails with clear error when MERCADOPAGO_ACCESS_TOKEN is missing', () => {
      expect(() =>
        resolvePaymentGateway({ PAYMENT_PROVIDER: 'mercadopago' }),
      ).toThrow('MERCADOPAGO_ACCESS_TOKEN is required when PAYMENT_PROVIDER=mercadopago');
    });
  });

  describe('stripe provider', () => {
    it('reads STRIPE_SECRET_KEY from env', () => {
      const result = resolvePaymentGateway({
        PAYMENT_PROVIDER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_test_123',
      });
      expect(result.provider).toBe('stripe');
      expect(result.options.stripeSecretKey).toBe('sk_test_123');
    });

    it('fails with clear error when STRIPE_SECRET_KEY is missing', () => {
      expect(() =>
        resolvePaymentGateway({ PAYMENT_PROVIDER: 'stripe' }),
      ).toThrow('STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe');
    });
  });
});
