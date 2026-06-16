/**
 * Tests for OpenCode Adapter
 * Task 4.3: OpenCode provider with chat and healthCheck
 */

import { OpenCodeAdapter } from './opencode.adapter';

describe('OpenCodeAdapter', () => {
  let adapter: OpenCodeAdapter;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    adapter = new OpenCodeAdapter('opencode-test-key', 'https://api.opencode.ai');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('chat', () => {
    it('calls OpenCode API and returns response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: 'Building management tip',
          actions: ['VIEW_PAYMENTS'],
        }),
      });

      const result = await adapter.chat('How do I check payments?', { tenantId: 't1' });
      expect(result.answer).toBeDefined();
    });

    it('handles API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(adapter.chat('Hello', {})).rejects.toThrow();
    });
  });

  describe('healthCheck', () => {
    it('returns healthy when API responds', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ok' }) });

      const status = await adapter.healthCheck();
      expect(status.status).toBe('healthy');
      expect(status.provider).toBe('opencode');
    });

    it('returns unavailable on connection error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const status = await adapter.healthCheck();
      expect(status.status).toBe('unavailable');
      expect(status.provider).toBe('opencode');
    });
  });
});