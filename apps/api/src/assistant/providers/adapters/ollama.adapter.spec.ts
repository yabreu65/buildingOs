/**
 * Tests for Ollama Adapter (refactored)
 * Task 4.4: Move ollama.provider → ollama.adapter.ts, add healthCheck
 */

import { OllamaAdapter } from './ollama.adapter';

describe('OllamaAdapter', () => {
  let adapter: OllamaAdapter;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    adapter = new OllamaAdapter('http://ollama-test:11434');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('chat', () => {
    it('calls Ollama API and returns response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: '{"answer": "Hello from Ollama", "actions": ["VIEW_TICKETS"]}' },
        }),
      });

      const result = await adapter.chat('Hello', { tenantId: 't1' });
      expect(result.answer).toBe('Hello from Ollama');
    });

    it('handles raw text response when JSON parse fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'Just a plain text response' },
        }),
      });

      const result = await adapter.chat('Hello', {});
      expect(result.answer).toContain('plain text');
    });

    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(adapter.chat('Hello', {})).rejects.toThrow();
    });
  });

  describe('healthCheck', () => {
    it('returns healthy when Ollama is reachable', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: 'llama3:latest' }],
        }),
      });

      const status = await adapter.healthCheck();
      expect(status.status).toBe('healthy');
      expect(status.provider).toBe('ollama');
      expect(status.modelsAvailable).toContain('llama3:latest');
    });

    it('returns unavailable when Ollama is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const status = await adapter.healthCheck();
      expect(status.status).toBe('unavailable');
      expect(status.provider).toBe('ollama');
    });
  });

  it('fails at construction if URL is empty', () => {
    expect(() => new OllamaAdapter('')).toThrow();
  });
});