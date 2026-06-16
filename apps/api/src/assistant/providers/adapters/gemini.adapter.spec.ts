/**
 * Tests for Gemini Adapter
 */

import { GeminiAdapter } from './gemini.adapter';

describe('GeminiAdapter', () => {
  let adapter: GeminiAdapter;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    adapter = new GeminiAdapter('test-gemini-key', 'gemini-2.0-flash');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('chat', () => {
    it('calls Gemini API and returns response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"answer": "Hello", "actions": ["VIEW_TICKETS"]}' }] } }],
        }),
      });

      const result = await adapter.chat('Hello', { tenantId: 't1' });

      expect(result.answer).toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('generativelanguage.googleapis.com');
      expect(url).toContain('key=test-gemini-key');
      expect(init.method).toBe('POST');
    });

    it('includes systemInstruction and generationConfig in request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
      });

      await adapter.chat('Test', { buildingId: 'b1' });

      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.systemInstruction.parts[0].text).toContain('BuildingOS');
      expect(body.systemInstruction.parts[0].text).toContain('b1');
      expect(body.generationConfig.maxOutputTokens).toBe(400);
    });

    it('handles API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      await expect(adapter.chat('Hello', {})).rejects.toThrow('Gemini API error');
    });

    it('handles empty candidates array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ candidates: [] }),
      });

      const result = await adapter.chat('Hello', {});
      expect(result.answer).toBe('Unable to generate response');
    });
  });

  describe('healthCheck', () => {
    it('returns healthy when models endpoint responds', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] }),
      });

      const status = await adapter.healthCheck();
      expect(status.status).toBe('healthy');
      expect(status.provider).toBe('gemini');
      expect(status.latencyMs).toBeDefined();
    });

    it('returns unavailable when API fails with error status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const status = await adapter.healthCheck();
      expect(status.status).toBe('unavailable');
      expect(status.provider).toBe('gemini');
      expect(status.error).toContain('500');
    });

    it('returns unavailable on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const status = await adapter.healthCheck();
      expect(status.status).toBe('unavailable');
      expect(status.provider).toBe('gemini');
    });
  });
});
