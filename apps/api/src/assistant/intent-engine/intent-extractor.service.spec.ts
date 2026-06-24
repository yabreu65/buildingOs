import {
  IntentExtractorService,
  parseGeminiStructuredIntentResponse,
} from './intent-extractor.service';

// Create mock functions at the top level
const mockCreatePlan = jest.fn();
const mockLogExecution = jest.fn();

// Mock global fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

const mockQueryPlanServiceInstance = {
  createPlan: mockCreatePlan,
};

const mockFeedbackServiceInstance = {
  logExecution: mockLogExecution,
};
const mockFilterCoverageValidatorInstance = {
  analyze: jest.fn(),
};

describe('IntentExtractorService', () => {
  let service: IntentExtractorService;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AI_PROVIDER;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    delete process.env.AI_GEMINI_MODEL;
    delete process.env.OPENCODE_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key';
    service = new IntentExtractorService(
      mockQueryPlanServiceInstance as any,
      mockFeedbackServiceInstance as any,
      mockFilterCoverageValidatorInstance as any,
    );
    mockFilterCoverageValidatorInstance.analyze.mockReturnValue({
      complete: true,
      detectedSignals: [],
      missingFields: [],
    });
  });

  afterEach(() => {
    mockFetch.mockReset();
  });

  describe('extractIntent', () => {
    it('extracts intent from valid LLM response when deterministic fails', async () => {
      mockCreatePlan.mockReturnValue(null); // Force LLM path
      process.env.GEMINI_API_KEY = 'test-key';
      process.env.GEMINI_MODEL = 'gemini-2.5-flash-lite';

      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    intent: 'list_payments',
                    entity: { type: 'unit', buildingAlias: 'A', unitCode: '0101' },
                    filters: { status: 'pending' },
                    confidence: 0.85,
                  }),
                },
              ],
            },
          },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.extractIntent('¿Cuántos pagos pendientes tiene A-0101?');

      expect(result).toBeDefined();
      expect(result.intent).toBe('list_payments');
      expect(result.entity.type).toBe('unit');
      expect(result.entity.buildingAlias).toBe('A');
      expect(result.entity.unitCode).toBe('0101');
      expect(result.confidence).toBe(0.85);
      expect(result.llmProvider).toBe('gemini');
    });

    it('falls back to deterministic keyword matching on timeout', async () => {
      mockFetch.mockRejectedValue(new Error('Timeout'));

      const mockPlan = {
        intent: 'unit_debt',
        module: 'payments',
        scope: 'unit',
        executor: 'unit_debt',
        filters: { unitCode: '0101', buildingAlias: 'A', minAmount: undefined },
        confidence: 0.92,
        source: 'deterministic_rules',
      };
      mockCreatePlan.mockReturnValue(mockPlan);

      const result = await service.extractIntent('¿Cuánto debe A-0101?');

      expect(result).toBeDefined();
      expect(result.intent).toBe('unit_debt');
      expect(result.confidence).toBe(0.92);
      expect(result.source).toBe('deterministic');
    });

    it('maps deterministic buildingToken into entity.buildingAlias', async () => {
      mockCreatePlan.mockReturnValue({
        intent: 'building_payments',
        module: 'payments',
        scope: 'building',
        executor: 'building_payments',
        filters: { buildingToken: 'A', period: '2026-04', method: 'TRANSFER' },
        confidence: 0.9,
        source: 'deterministic_rules',
      });

      const result = await service.extractIntent('Pagos por banco del mes pasado en Torre A');

      expect(result.intent).toBe('building_payments');
      expect(result.entity.type).toBe('building');
      expect(result.entity.buildingAlias).toBe('A');
    });

    it('keeps tenant_debt as a deterministic extraction result', async () => {
      mockCreatePlan.mockReturnValue({
        intent: 'tenant_debt',
        module: 'payments',
        scope: 'tenant',
        executor: 'tenant_debt',
        filters: {},
        confidence: 0.9,
        source: 'deterministic_rules',
      });

      const result = await service.extractIntent('deuda total de la administracion');

      expect(result.intent).toBe('tenant_debt');
      expect(result.entity.type).toBe('building');
      expect(result.confidence).toBe(0.9);
    });

    it('uses Gemini first when deterministic confidence is below 90%', async () => {
      mockCreatePlan.mockReturnValue({
        intent: 'building_debt',
        module: 'payments',
        scope: 'building',
        executor: 'building_debt',
        filters: { buildingToken: 'B' },
        confidence: 0.89,
        source: 'deterministic_rules',
      });
      process.env.GEMINI_API_KEY = 'test-key';
      process.env.GEMINI_MODEL = 'gemini-2.5-flash-lite';

      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('generativelanguage.googleapis.com')) {
          return {
            ok: true,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          intent: 'building_debt',
                          entity: { type: 'building', buildingAlias: 'B' },
                          filters: { period: '2026-06' },
                          confidence: 0.95,
                        }),
                      },
                    ],
                  },
                },
              ],
            }),
          };
        }

        throw new Error(`Unexpected non-Gemini URL: ${url}`);
      });

      const result = await service.extractIntent('deuda del edificio B');

      expect(result.intent).toBe('building_debt');
      expect(result.llmProvider).toBe('gemini');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0]?.[0]).toContain('generativelanguage.googleapis.com');
      const requestBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body ?? '{}');
      expect(requestBody.generationConfig.responseMimeType).toBe('application/json');
      expect(requestBody.generationConfig.responseSchema).toBeDefined();
      expect(JSON.stringify(requestBody.generationConfig.responseSchema)).not.toContain('additionalProperties');
    });

    it('uses Gemini structured output parser for valid structured responses', () => {
      const result = parseGeminiStructuredIntentResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    intent: 'building_payments',
                    entity: { type: 'building', buildingAlias: 'A' },
                    filters: { period: '2026-06', method: 'TRANSFER' },
                    confidence: 0.92,
                  }),
                },
              ],
            },
          },
        ],
      });

      expect(result.intent).toBe('building_payments');
      expect(result.entity.type).toBe('building');
      expect(result.filters.period).toBe('2026-06');
      expect(result.confidence).toBe(0.92);
    });

    it.each([
      ['no candidates', {}],
      ['candidates without text', { candidates: [{ content: { parts: [{}] } }] }],
    ])('fails gracefully when Gemini response has %s', (_, payload) => {
      expect(() => parseGeminiStructuredIntentResponse(payload)).toThrow(
        'Gemini returned no parseable structured intent response',
      );
    });

    it('fails gracefully when Gemini text is not JSON', () => {
      expect(() =>
        parseGeminiStructuredIntentResponse({
          candidates: [
            {
              content: {
                parts: [{ text: 'not json' }],
              },
            },
          ],
        }),
      ).toThrow('Gemini returned non-JSON structured intent response');
    });

    it('fails gracefully when Gemini JSON does not satisfy the backend schema', () => {
      expect(() =>
        parseGeminiStructuredIntentResponse({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      intent: 'building_payments',
                      entity: { type: 'building' },
                      filters: {},
                      confidence: 0.92,
                      unexpected: true,
                    }),
                  },
                ],
              },
            },
          ],
        }),
      ).toThrow('Gemini structured intent validation failed:');
    });

    it('calls LLM when deterministic intent exists but filter coverage is incomplete', async () => {
      mockCreatePlan.mockReturnValue({
        intent: 'building_payments',
        module: 'payments',
        scope: 'building',
        executor: 'building_payments',
        filters: {},
        confidence: 0.9,
        source: 'deterministic_rules',
      });
      mockFilterCoverageValidatorInstance.analyze.mockReturnValue({
        complete: false,
        detectedSignals: ['period', 'method'],
        missingFields: ['period', 'method'],
      });

      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    intent: 'building_payments',
                    entity: { type: 'building', buildingAlias: 'A' },
                    filters: { period: '2026-01', method: 'TRANSFER' },
                    confidence: 0.88,
                  }),
                },
              ],
            },
          },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.extractIntent('Pagos de enero por transferencia');

      expect(result.intent).toBe('building_payments');
      expect(result.filters.period).toBe('2026-01');
      expect(result.filters.method).toBe('TRANSFER');
    });

    it('rejects LLM response when confidence is below threshold', async () => {
      mockCreatePlan.mockReturnValue(null); // Force LLM path
      process.env.GEMINI_API_KEY = 'test-key';
      const geminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    intent: 'list_payments',
                    entity: { type: 'unit', buildingAlias: 'A', unitCode: '0101' },
                    filters: {},
                    confidence: 0.5, // Below 0.70 threshold
                  }),
                },
              ],
            },
          },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => geminiResponse,
      });

      await expect(service.extractIntent('¿Cuánto debe A-0101?')).rejects.toThrow(/Confidence 0.5 below threshold 0.7/);
    });

    it('uses Gemini fallback when deterministic fails', async () => {
      mockCreatePlan.mockReturnValue(null);
      process.env.GEMINI_API_KEY = 'test-key';
      process.env.GEMINI_MODEL = 'gemini-2.5-flash-lite';

      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('generativelanguage.googleapis.com')) {
          return {
            ok: true,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          intent: 'building_debt',
                          entity: { type: 'building', buildingAlias: 'B' },
                          filters: { period: '2026-06' },
                          confidence: 0.91,
                        }),
                      },
                    ],
                  },
                },
              ],
            }),
          };
        }

        throw new Error(`Unexpected URL ${url}`);
      });

      const result = await service.extractIntent('deuda del edificio B, del mes actual');

      expect(result.intent).toBe('building_debt');
      expect(result.filters.period).toBe('2026-06');
      expect(result.llmProvider).toBe('gemini');
    });

    it('does not map structured tenant cobro responses to missing data', async () => {
      mockCreatePlan.mockReturnValue(null);
      process.env.GEMINI_API_KEY = 'test-key';

      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('generativelanguage.googleapis.com')) {
          return {
            ok: true,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          intent: 'building_payments',
                          entity: { type: 'building' },
                          filters: { period: '2026-06', method: 'TRANSFER' },
                          confidence: 0.91,
                        }),
                      },
                    ],
                  },
                },
              ],
            }),
          };
        }

        throw new Error(`Unexpected URL ${url}`);
      });

      await expect(service.extractIntent('lo cobrado del mes en curso de la administracion')).resolves.toMatchObject({
        intent: 'building_payments',
        filters: expect.objectContaining({ period: '2026-06' }),
      });
    });

    it('logs execution via AssistantFeedbackService', async () => {
      mockCreatePlan.mockReturnValue(null); // Force LLM path

      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    intent: 'list_payments',
                    entity: { type: 'unit', buildingAlias: 'A', unitCode: '0101' },
                    filters: {},
                    confidence: 0.85,
                  }),
                },
              ],
            },
          },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      await service.extractIntent('¿Cuántos pagos pendientes tiene A-0101?');

      expect(mockLogExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: 'list_payments',
          success: true,
        }),
      );
    });

    it('does not include tenantId or roles in LLM prompt', async () => {
      mockCreatePlan.mockReturnValue(null); // Force LLM path

      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    intent: 'list_payments',
                    entity: { type: 'unit' },
                    filters: {},
                    confidence: 0.85,
                  }),
                },
              ],
            },
          },
        ],
      };

      let capturedUrl = '';
      let capturedBody: { messages?: Array<{ content?: string }> } | null = null;
      mockFetch.mockImplementation(async (url: string, init?: { body?: string }) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init?.body ?? '{}') as { messages?: Array<{ content?: string }> };
        return {
          ok: true,
          json: async () => mockResponse,
        };
      });

      await service.extractIntent('¿Cuántos pagos pendientes tiene A-0101?', {
        userId: 'user-456',
      });

      const systemPrompt = capturedBody?.messages?.[0]?.content ?? '';
      expect(systemPrompt).not.toContain('tenant-123');
      expect(systemPrompt).not.toContain('tenantId');
      expect(systemPrompt).not.toContain('roles');
      expect(systemPrompt).not.toContain('permissions');
    });
  });
});
