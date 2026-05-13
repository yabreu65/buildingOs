import { IntentExtractorService } from './intent-extractor.service';

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
    service = new IntentExtractorService(
      undefined as any, // ollamaProvider no longer used
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

      const mockResponse = {
        message: {
          content: JSON.stringify({
            intent: 'list_payments',
            entity: { type: 'unit', buildingAlias: 'A', unitCode: '0101' },
            filters: { status: 'pending' },
            confidence: 0.85,
          }),
        },
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
      expect(result.llmProvider).toBe('ollama');
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
        message: {
          content: JSON.stringify({
            intent: 'building_payments',
            entity: { type: 'building', buildingAlias: 'A' },
            filters: { period: '2026-01', method: 'TRANSFER' },
            confidence: 0.88,
          }),
        },
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
      process.env.OPENCODE_API_KEY = 'test-key';

      const ollamaResponse = {
        message: {
          content: JSON.stringify({
            intent: 'list_payments',
            entity: { type: 'unit', buildingAlias: 'A', unitCode: '0101' },
            filters: {},
            confidence: 0.5, // Below 0.70 threshold
          }),
        },
      };

      const opencodeResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              intent: 'list_payments',
              entity: { type: 'unit', buildingAlias: 'A', unitCode: '0101' },
              filters: {},
              confidence: 0.5, // Below 0.70 threshold
            }),
          },
        }],
      };

      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('opencode')) {
          return { ok: true, json: async () => opencodeResponse };
        }
        return { ok: true, json: async () => ollamaResponse };
      });

      await expect(service.extractIntent('¿Cuánto debe A-0101?')).rejects.toThrow(/Confidence 0.5 below threshold 0.7/);

      delete process.env.OPENCODE_API_KEY;
    });

    it('tracks opencode as provider when ollama fails and opencode succeeds', async () => {
      mockCreatePlan.mockReturnValue(null);
      process.env.OPENCODE_API_KEY = 'test-key';

      const opencodeResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              intent: 'building_tickets',
              entity: { type: 'building', buildingAlias: 'A' },
              filters: { status: 'OPEN' },
              confidence: 0.88,
            }),
          },
        }],
      };

      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('/api/chat')) {
          throw new Error('Ollama unavailable');
        }
        if (url.includes('opencode')) {
          return { ok: true, json: async () => opencodeResponse };
        }
        throw new Error(`Unexpected URL ${url}`);
      });

      const result = await service.extractIntent('Tickets abiertos del edificio A');

      expect(result.intent).toBe('building_tickets');
      expect(result.llmProvider).toBe('opencode');

      delete process.env.OPENCODE_API_KEY;
    });

    it('logs execution via AssistantFeedbackService', async () => {
      mockCreatePlan.mockReturnValue(null); // Force LLM path

      const mockResponse = {
        message: {
          content: JSON.stringify({
            intent: 'list_payments',
            entity: { type: 'unit', buildingAlias: 'A', unitCode: '0101' },
            filters: {},
            confidence: 0.85,
          }),
        },
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
        message: {
          content: JSON.stringify({
            intent: 'list_payments',
            entity: { type: 'unit' },
            filters: {},
            confidence: 0.85,
          }),
        },
      };

      let capturedUrl = '';
      let capturedBody: any = null;
      mockFetch.mockImplementation(async (url: string, init: any) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init.body);
        return {
          ok: true,
          json: async () => mockResponse,
        };
      });

      await service.extractIntent('¿Cuántos pagos pendientes tiene A-0101?', {
        userId: 'user-456',
      });

      const systemPrompt = capturedBody.messages[0].content;
      expect(systemPrompt).not.toContain('tenant-123');
      expect(systemPrompt).not.toContain('tenantId');
      expect(systemPrompt).not.toContain('roles');
      expect(systemPrompt).not.toContain('permissions');
    });
  });
});
