import { IntentExtractorService } from './intent-extractor.service';

// Create mock functions at the top level
const mockChat = jest.fn();
const mockCreatePlan = jest.fn();
const mockLogExecution = jest.fn();

// Create mock instances with mock implementations
const mockOllamaProviderInstance = {
  chat: mockChat,
};

const mockQueryPlanServiceInstance = {
  createPlan: mockCreatePlan,
};

const mockFeedbackServiceInstance = {
  logExecution: mockLogExecution,
};

describe('IntentExtractorService', () => {
  let service: IntentExtractorService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new IntentExtractorService(
      mockOllamaProviderInstance as any,
      mockQueryPlanServiceInstance as any,
      mockFeedbackServiceInstance as any,
    );
  });

  describe('extractIntent', () => {
    it('extracts intent from valid LLM response', async () => {
      const mockResponse = {
        answer: JSON.stringify({
          intent: 'list_payments',
          entity: { type: 'unit', buildingAlias: 'A', unitCode: '0101' },
          filters: { status: 'pending' },
          confidence: 0.85,
        }),
        suggestedActions: [],
      };

      mockChat.mockResolvedValue(mockResponse);

      const result = await service.extractIntent('¿Cuántos pagos pendientes tiene A-0101?');

      expect(result).toBeDefined();
      expect(result.intent).toBe('list_payments');
      expect(result.entity.type).toBe('unit');
      expect(result.entity.buildingAlias).toBe('A');
      expect(result.entity.unitCode).toBe('0101');
      expect(result.confidence).toBe(0.85);
    });

    it('falls back to deterministic keyword matching on timeout', async () => {
      mockChat.mockRejectedValue(new Error('Timeout'));

      const mockPlan = {
        intent: 'unit_debt',
        module: 'payments',
        scope: 'unit',
        executor: 'unit_debt',
        filters: { unitCode: '0101', buildingAlias: 'A' },
        confidence: 0.92,
        source: 'deterministic_rules',
      };
      mockCreatePlan.mockReturnValue(mockPlan);

      const result = await service.extractIntent('¿Cuánto debe A-0101?');

      expect(result).toBeDefined();
      expect(result.intent).toBe('unit_debt');
      expect(result.confidence).toBe(0.92);
    });

    it('returns deterministic result when confidence is below threshold', async () => {
      const mockResponse = {
        answer: JSON.stringify({
          intent: 'list_payments',
          entity: { type: 'unit', buildingAlias: 'A', unitCode: '0101' },
          filters: {},
          confidence: 0.5, // Below 0.70 threshold
        }),
        suggestedActions: [],
      };

      mockChat.mockResolvedValue(mockResponse);

      const mockPlan = {
        intent: 'unit_debt',
        module: 'payments',
        scope: 'unit',
        executor: 'unit_debt',
        filters: { unitCode: '0101', buildingAlias: 'A' },
        confidence: 0.92,
        source: 'deterministic_rules',
      };
      mockCreatePlan.mockReturnValue(mockPlan);

      const result = await service.extractIntent('¿Cuánto debe A-0101?');

      expect(result).toBeDefined();
      expect(result.intent).toBe('unit_debt');
      expect(result.confidence).toBe(0.92);
    });

    it('logs execution via AssistantFeedbackService', async () => {
      const mockResponse = {
        answer: JSON.stringify({
          intent: 'list_payments',
          entity: { type: 'unit', buildingAlias: 'A', unitCode: '0101' },
          filters: {},
          confidence: 0.85,
        }),
        suggestedActions: [],
      };

      mockChat.mockResolvedValue(mockResponse);

      await service.extractIntent('¿Cuántos pagos pendientes tiene A-0101?');

      expect(mockLogExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: 'list_payments',
          success: true,
        }),
      );
    });

    it('does not include tenantId or roles in LLM prompt', async () => {
      const mockResponse = {
        answer: JSON.stringify({
          intent: 'list_payments',
          entity: { type: 'unit' },
          filters: {},
          confidence: 0.85,
        }),
        suggestedActions: [],
      };

      let capturedMessage = '';
      mockChat.mockImplementation(async (message: string) => {
        capturedMessage = message;
        return mockResponse;
      });

      await service.extractIntent('¿Cuántos pagos pendientes tiene A-0101?', {
        userId: 'user-456',
      });

      expect(capturedMessage).not.toContain('tenant-123');
      expect(capturedMessage).not.toContain('tenantId');
      expect(capturedMessage).not.toContain('roles');
      expect(capturedMessage).not.toContain('permissions');
    });
  });
});
