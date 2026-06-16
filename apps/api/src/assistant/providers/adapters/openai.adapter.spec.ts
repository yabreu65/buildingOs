/**
 * Tests for OpenAI Adapter
 * Task 4.2: OpenAI provider with chat and healthCheck
 */

import { OpenAiAdapter } from './openai.adapter';

describe('OpenAiAdapter', () => {
  let adapter: OpenAiAdapter;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    adapter = new OpenAiAdapter('sk-test-key', 'gpt-4o-mini');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('chat', () => {
    it('calls OpenAI API and returns response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"answer": "Hello", "actions": ["VIEW_TICKETS"]}' } }],
        }),
      });

      const result = await adapter.chat('Hello', { tenantId: 't1' });

      expect(result.answer).toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('handles API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      await expect(adapter.chat('Hello', {})).rejects.toThrow();
    });
  });

  describe('healthCheck', () => {
    it('returns healthy when API responds', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      const status = await adapter.healthCheck();
      expect(status.status).toBe('healthy');
      expect(status.provider).toBe('openai');
    });

    it('returns unavailable when API fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const status = await adapter.healthCheck();
      expect(status.status).toBe('unavailable');
      expect(status.provider).toBe('openai');
    });
  });
});