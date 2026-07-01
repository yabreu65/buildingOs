/**
 * Tests for Stripe Adapter
 * Task 2.2: Verify createPreference, handleWebhook, getChargeStatus
 */

import { StripeAdapter } from './stripe.adapter';
import { BadRequestException } from '@nestjs/common';

describe('StripeAdapter', () => {
  let adapter: StripeAdapter;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    adapter = new StripeAdapter('sk_test_stripe_key');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createPreference', () => {
    it('creates a checkout session and returns URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'cs_test_123',
          url: 'https://checkout.stripe.com/pay/cs_test_123',
          expires_at: Math.floor(Date.now() / 1000) + 1800,
        }),
      });

      const result = await adapter.createPreference({
        chargeId: 'charge-1',
        tenantId: 'tenant-1',
        amount: 10000,
        currency: 'usd',
        concept: 'Test charge',
      });

      expect(result.preferenceId).toBe('cs_test_123');
      expect(result.checkoutUrl).toBe('https://checkout.stripe.com/pay/cs_test_123');
      expect(result.provider).toBe('stripe');
    });

    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      await expect(
        adapter.createPreference({
          chargeId: 'charge-1',
          tenantId: 'tenant-1',
          amount: 10000,
          currency: 'usd',
          concept: 'Test',
        }),
      ).rejects.toThrow('Stripe API error');
    });

    it('sends correct authorization header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'cs_1', url: 'https://stripe.com/1' }),
      });

      await adapter.createPreference({
        chargeId: 'c1',
        tenantId: 't1',
        amount: 5000,
        currency: 'usd',
        concept: 'Test',
      });

      const call = mockFetch.mock.calls[0];
      expect(call[1]?.headers?.Authorization).toBe('Bearer sk_test_stripe_key');
    });
  });

  describe('handleWebhook', () => {
    it('parses checkout.session.completed webhook', async () => {
      const payload = {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_123',
            payment_status: 'paid',
            metadata: { chargeId: 'charge-1' },
            payment_intent: 'pi_123',
          },
        },
      };

      const result = await adapter.handleWebhook(payload, 'sig');
      expect(result.eventId).toBe('cs_123');
      expect(result.status).toBe('PAID');
      expect(result.chargeId).toBe('charge-1');
    });

    it('parses checkout.session.expired webhook as CANCELLED', async () => {
      const payload = {
        type: 'checkout.session.expired',
        data: {
          object: {
            id: 'cs_456',
            payment_status: 'unpaid',
            metadata: { chargeId: 'charge-2' },
          },
        },
      };

      const result = await adapter.handleWebhook(payload, 'sig');
      expect(result.status).toBe('CANCELLED');
    });

    it('throws on unknown event type', async () => {
      const payload = { type: 'unknown.event', data: {} };

      await expect(adapter.handleWebhook(payload, 'sig')).rejects.toThrow();
    });

    it('surfaces malformed payloads as HTTP 400 errors', async () => {
      await expect(adapter.handleWebhook({}, 'sig')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getChargeStatus', () => {
    it('returns PAID for paid session', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'cs_1',
          payment_status: 'paid',
          metadata: { chargeId: 'charge-1' },
        }),
      });

      const status = await adapter.getChargeStatus('cs_1');
      expect(status).toBe('PAID');
    });

    it('returns CANCELLED for expired session', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'cs_2',
          payment_status: 'unpaid',
          metadata: {},
        }),
      });

      const status = await adapter.getChargeStatus('cs_2');
      expect(status).toBe('CANCELLED');
    });
  });
});
