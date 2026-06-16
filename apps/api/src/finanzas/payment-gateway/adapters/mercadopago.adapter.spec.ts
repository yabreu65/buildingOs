/**
 * Tests for MercadoPago Adapter
 * Task 2.1: Verify createPreference, handleWebhook, getChargeStatus
 */

import { MercadoPagoAdapter } from './mercadopago.adapter';
import { PaymentStatus } from '../interfaces/payment-provider.interface';

describe('MercadoPagoAdapter', () => {
  let adapter: MercadoPagoAdapter;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    adapter = new MercadoPagoAdapter('test-mp-token');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createPreference', () => {
    it('creates a preference and returns checkout URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'mp-pref-123',
          init_point: 'https://checkout.mercadopago.com/pay/123',
        }),
      });

      const result = await adapter.createPreference({
        chargeId: 'charge-1',
        tenantId: 'tenant-1',
        amount: 10000,
        currency: 'ARS',
        concept: 'Test charge',
      });

      expect(result.preferenceId).toBe('mp-pref-123');
      expect(result.checkoutUrl).toBe('https://checkout.mercadopago.com/pay/123');
      expect(result.provider).toBe('mercadopago');
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
          currency: 'ARS',
          concept: 'Test',
        }),
      ).rejects.toThrow('MercadoPago API error');
    });

    it('sends correct headers with access token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'mp-1', init_point: 'https://mp.com/1' }),
      });

      await adapter.createPreference({
        chargeId: 'c1',
        tenantId: 't1',
        amount: 5000,
        currency: 'ARS',
        concept: 'Test',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0];
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers?.Authorization).toBe('Bearer test-mp-token');
    });
  });

  describe('handleWebhook', () => {
    it('parses approved payment webhook', async () => {
      const payload = {
        action: 'payment.updated',
        data: { id: 'pay-123' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'pay-123',
          status: 'approved',
          external_reference: 'charge-1',
        }),
      });

      const result = await adapter.handleWebhook(payload, 'valid-sig');

      expect(result.eventId).toBe('pay-123');
      expect(result.status).toBe('PAID');
      expect(result.externalId).toBe('pay-123');
    });

    it('parses rejected payment webhook', async () => {
      const payload = {
        action: 'payment.updated',
        data: { id: 'pay-456' },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'pay-456',
          status: 'rejected',
          external_reference: 'charge-2',
        }),
      });

      const result = await adapter.handleWebhook(payload, 'valid-sig');

      expect(result.status).toBe('REJECTED');
    });

    it('maps pending status correctly', async () => {
      const payload = { action: 'payment.created', data: { id: 'pay-789' } };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'pay-789',
          status: 'pending',
          external_reference: 'charge-3',
        }),
      });

      const result = await adapter.handleWebhook(payload, 'valid-sig');
      expect(result.status).toBe('PENDING');
    });
  });

  describe('getChargeStatus', () => {
    it('returns PAID for approved payment', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'pay-1', status: 'approved' }),
      });

      const status = await adapter.getChargeStatus('pay-1');
      expect(status).toBe('PAID');
    });

    it('returns REJECTED for rejected payment', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'pay-2', status: 'rejected' }),
      });

      const status = await adapter.getChargeStatus('pay-2');
      expect(status).toBe('REJECTED');
    });

    it('returns PENDING for pending payment', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'pay-3', status: 'pending' }),
      });

      const status = await adapter.getChargeStatus('pay-3');
      expect(status).toBe('PENDING');
    });

    it('returns CANCELLED for cancelled payment', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'pay-4', status: 'cancelled' }),
      });

      const status = await adapter.getChargeStatus('pay-4');
      expect(status).toBe('CANCELLED');
    });
  });
});