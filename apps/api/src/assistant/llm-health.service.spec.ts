import { AssistantLlmHealthService } from './llm-health.service';

describe('AssistantLlmHealthService', () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.AI_OLLAMA_URL = 'http://ollama-test:11434';
    process.env.AI_OLLAMA_MODEL = 'llama3:latest';
    process.env.AI_INTENT_ENGINE_ENABLED = 'true';
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns reachable=true with models from /api/tags', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: 'llama3:latest' }, { name: 'nemotron-3-super:cloud' }],
      }),
    }) as any;

    // No AI provider injected — falls back to legacy Ollama check
    const service = new AssistantLlmHealthService(null);
    const result = await service.getHealth();

    expect(result.enabled).toBe(true);
    expect(result.provider).toBe('ollama');
    expect(result.baseUrl).toBe('http://ollama-test:11434');
    expect(result.model).toBe('llama3:latest');
    expect(result.reachable).toBe(true);
    expect(result.modelsAvailable).toEqual(['llama3:latest', 'nemotron-3-super:cloud']);
  });

  it('returns not configured when no baseUrl and no provider', async () => {
    process.env.AI_OLLAMA_URL = '';
    process.env.AI_PROVIDER = 'none';

    const service = new AssistantLlmHealthService(null);
    const result = await service.getHealth();

    expect(result.enabled).toBe(false);
    expect(result.provider).toBe('none');
    expect(result.reachable).toBe(false);
  });

  it('returns unavailable when Ollama is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

    const service = new AssistantLlmHealthService(null);
    const result = await service.getHealth();

    expect(result.reachable).toBe(false);
    expect(result.provider).toBe('ollama');
  });
});