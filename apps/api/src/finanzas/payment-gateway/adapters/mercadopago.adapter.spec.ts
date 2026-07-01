/**
 * Tests for MercadoPago Adapter
 * Task 2.1: Verify createPreference, handleWebhook, getChargeStatus
 */

import { MercadoPagoAdapter } from './mercadopago.adapter';
import { PaymentStatus } from '../interfaces/payment-provider.interface';
import { createHmac } from 'crypto';

describe('MercadoPagoAdapter', () => {
  const webhookSecret = 'test-webhook-secret';

  let adapter: MercadoPagoAdapter;
  let mockFetch: jest.Mock;

  const buildSignature = (dataId: string, requestId: string, timestamp = '1678886400'): string => {
    const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
    const digest = createHmac('sha256', webhookSecret).update(manifest).digest('hex');
    return `ts=${timestamp},v1=${digest}`;
  };

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    adapter = new MercadoPagoAdapter('test-mp-token', webhookSecret);
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
    it('validates the MercadoPago signature, fetches payment details, and parses approved payment webhook', async () => {
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

      const result = await adapter.handleWebhook(payload, buildSignature('pay-123', 'request-123'), {
        requestId: 'request-123',
        dataId: 'pay-123',
      });

      expect(result.eventId).toBe('pay-123');
      expect(result.status).toBe('PAID');
      expect(result.externalId).toBe('pay-123');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid v1 signature before fetching payment details', async () => {
      await expect(
        adapter.handleWebhook({ action: 'payment.updated', data: { id: 'pay-123' } }, `ts=1678886400,v1=${'0'.repeat(64)}`, {
          requestId: 'request-123',
          dataId: 'pay-123',
        }),
      ).rejects.toThrow('MercadoPago webhook: invalid signature');

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it.each([
      ['x-signature', { signature: undefined, requestId: 'request-123', dataId: 'pay-123' }],
      ['x-request-id', { signature: buildSignature('pay-123', 'request-123'), requestId: undefined, dataId: 'pay-123' }],
      ['data.id', { signature: buildSignature('pay-123', 'request-123'), requestId: 'request-123', dataId: undefined }],
      ['ts', { signature: `v1=${buildSignature('pay-123', 'request-123').split('v1=')[1]}`, requestId: 'request-123', dataId: 'pay-123' }],
      ['v1', { signature: 'ts=1678886400', requestId: 'request-123', dataId: 'pay-123' }],
    ])('rejects when %s is missing before fetching payment details', async (_field, signatureContext) => {
      await expect(
        adapter.handleWebhook(
          { action: 'payment.updated', data: { id: 'pay-123' } },
          signatureContext.signature || '',
          signatureContext,
        ),
      ).rejects.toThrow('MercadoPago webhook:');

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects when webhook secret is missing before fetching payment details', async () => {
      const adapterWithoutSecret = new MercadoPagoAdapter('test-mp-token');

      await expect(
        adapterWithoutSecret.handleWebhook({ action: 'payment.updated', data: { id: 'pay-123' } }, buildSignature('pay-123', 'request-123'), {
          requestId: 'request-123',
          dataId: 'pay-123',
        }),
      ).rejects.toThrow('MercadoPago webhook: missing webhook secret');

      expect(mockFetch).not.toHaveBeenCalled();
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

      const result = await adapter.handleWebhook(payload, buildSignature('pay-456', 'request-456'), {
        requestId: 'request-456',
        dataId: 'pay-456',
      });

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

      const result = await adapter.handleWebhook(payload, buildSignature('pay-789', 'request-789'), {
        requestId: 'request-789',
        dataId: 'pay-789',
      });
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
