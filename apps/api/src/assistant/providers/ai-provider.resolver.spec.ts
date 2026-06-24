/**
 * Tests for AI Provider Resolver
 * Verifies: default=none, reads env vars, missing creds fail with clear error
 */

import { resolveAiConsensusModeConfig, resolveAiProvider } from './ai-provider.resolver';

describe('resolveAiProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.AI_PROVIDER;
    delete process.env.AI_CONSENSUS_MODE;
    delete process.env.AI_ALWAYS_CALL_LOCAL_MODEL;
    delete process.env.AI_GEMINI_FALLBACK_ENABLED;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.AI_OLLAMA_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_MODEL;
    delete process.env.OPENCODE_API_KEY;
    delete process.env.OPENCODE_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('default behavior', () => {
    it('returns provider=none when AI_PROVIDER is not set', () => {
      const result = resolveAiProvider({});
      expect(result.provider).toBe('none');
    });

    it('returns provider=none when AI_PROVIDER is empty', () => {
      const result = resolveAiProvider({ AI_PROVIDER: '' });
      expect(result.provider).toBe('none');
    });
  });

  describe('openai provider', () => {
    it('reads OPENAI_API_KEY from env', () => {
      const result = resolveAiProvider({
        AI_PROVIDER: 'openai',
        OPENAI_API_KEY: 'sk-test',
        AI_OPENAI_MODEL: 'gpt-4o',
      });
      expect(result.provider).toBe('openai');
      expect(result.openaiApiKey).toBe('sk-test');
      expect(result.openaiModel).toBe('gpt-4o');
    });

    it('fails when OPENAI_API_KEY is missing', () => {
      expect(() =>
        resolveAiProvider({ AI_PROVIDER: 'openai' }),
      ).toThrow('OPENAI_API_KEY is required when AI_PROVIDER=openai');
    });
  });

  describe('ollama provider', () => {
    it('reads AI_OLLAMA_URL from env', () => {
      const result = resolveAiProvider({
        AI_PROVIDER: 'ollama',
        AI_OLLAMA_URL: 'http://ollama:11434',
      });
      expect(result.provider).toBe('ollama');
      expect(result.ollamaUrl).toBe('http://ollama:11434');
    });

    it('fails when AI_OLLAMA_URL is missing', () => {
      expect(() =>
        resolveAiProvider({ AI_PROVIDER: 'ollama' }),
      ).toThrow('AI_OLLAMA_URL is required when AI_PROVIDER=ollama');
    });
  });

  describe('hybrid provider', () => {
    it('reads OLLAMA_BASE_URL from env', () => {
      const result = resolveAiProvider({
        AI_PROVIDER: 'hybrid',
        OLLAMA_BASE_URL: 'http://localhost:11434',
      });

      expect(result.provider).toBe('ollama');
      expect(result.ollamaUrl).toBe('http://localhost:11434');
    });
  });

  describe('gemini provider', () => {
    it('reads GEMINI_API_KEY from env', () => {
      const result = resolveAiProvider({
        AI_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'AIza-test',
        AI_GEMINI_MODEL: 'gemini-2.0-flash',
      });
      expect(result.provider).toBe('gemini');
      expect(result.geminiApiKey).toBe('AIza-test');
      expect(result.geminiModel).toBe('gemini-2.0-flash');
    });

    it('prefers GEMINI_MODEL when provided', () => {
      const result = resolveAiProvider({
        AI_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'AIza-test',
        GEMINI_MODEL: 'gemini-2.5-flash-lite',
        AI_GEMINI_MODEL: 'gemini-2.0-flash',
      });
      expect(result.provider).toBe('gemini');
      expect(result.geminiModel).toBe('gemini-2.5-flash-lite');
    });

    it('fails when GEMINI_API_KEY is missing', () => {
      expect(() =>
        resolveAiProvider({ AI_PROVIDER: 'gemini' }),
      ).toThrow('GEMINI_API_KEY is required when AI_PROVIDER=gemini');
    });
  });

  describe('opencode provider', () => {
    it('reads OPENCODE creds from env (optional, no fail on missing)', () => {
      const result = resolveAiProvider({ AI_PROVIDER: 'opencode' });
      expect(result.provider).toBe('opencode');
      // opencode creds are optional — no throw
    });
  });

  describe('consensus mode config', () => {
    it('reads hybrid mode flags and local ollama settings', () => {
      const result = resolveAiConsensusModeConfig({
        AI_PROVIDER: 'hybrid',
        AI_CONSENSUS_MODE: 'true',
        AI_ALWAYS_CALL_LOCAL_MODEL: '1',
        AI_GEMINI_FALLBACK_ENABLED: 'false',
        OLLAMA_BASE_URL: 'http://localhost:11434',
        OLLAMA_MODEL: 'qwen2.5:3b',
      });

      expect(result).toEqual(expect.objectContaining({
        provider: 'hybrid',
        localProvider: 'ollama',
        consensusMode: true,
        alwaysCallLocalModel: true,
        geminiFallbackEnabled: false,
        ollamaBaseUrl: 'http://localhost:11434',
        ollamaModel: 'qwen2.5:3b',
      }));
    });
  });
});
