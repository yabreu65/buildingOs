import { AssistantLlmHealthService } from './llm-health.service';

describe('AssistantLlmHealthService', () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.AI_OLLAMA_URL = 'http://localhost:11434';
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

    const service = new AssistantLlmHealthService();
    const result = await service.getHealth();

    expect(result.enabled).toBe(true);
    expect(result.provider).toBe('ollama');
    expect(result.baseUrl).toBe('http://localhost:11434');
    expect(result.model).toBe('llama3:latest');
    expect(result.reachable).toBe(true);
    expect(result.modelsAvailable).toEqual(['llama3:latest', 'nemotron-3-super:cloud']);
  });
});
