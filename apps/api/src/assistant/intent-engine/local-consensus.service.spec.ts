import { AssistantLocalConsensusService } from './local-consensus.service';
import type { AssistantQueryPlan } from '../query-plan.types';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('AssistantLocalConsensusService', () => {
  let service: AssistantLocalConsensusService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AI_PROVIDER = 'hybrid';
    process.env.AI_CONSENSUS_MODE = 'true';
    process.env.AI_ALWAYS_CALL_LOCAL_MODEL = 'true';
    process.env.AI_GEMINI_FALLBACK_ENABLED = 'false';
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434';
    process.env.OLLAMA_MODEL = 'qwen2.5:3b';
    service = new AssistantLocalConsensusService();
  });

  afterEach(() => {
    delete process.env.AI_PROVIDER;
    delete process.env.AI_CONSENSUS_MODE;
    delete process.env.AI_ALWAYS_CALL_LOCAL_MODEL;
    delete process.env.AI_GEMINI_FALLBACK_ENABLED;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_MODEL;
    mockFetch.mockReset();
  });

  function buildDeterministicPlan(overrides: Partial<AssistantQueryPlan> = {}): AssistantQueryPlan {
    const currentMonth = new Date().toISOString().slice(0, 7);
    return {
      intent: 'building_debt',
      module: 'payments',
      scope: 'building',
      requiredPermission: 'payments.review',
      executor: 'building_debt',
      filters: {
        buildingAlias: 'A',
        buildingToken: 'A',
        period: currentMonth,
      },
      confidence: 0.9,
      source: 'deterministic_rules',
      ...overrides,
    };
  }

  it('returns consensus when deterministic and local plans match', async () => {
    const currentDate = new Date();
    const responsePayload = {
      message: {
        content: JSON.stringify({
          intent: 'building_debt',
          scope: 'building',
          entity: {
            buildingAlias: 'A',
            unitAlias: null,
          },
          period: {
            kind: 'current_month',
            month: currentDate.getMonth() + 1,
            year: currentDate.getFullYear(),
            offset: 0,
            amount: null,
            unit: 'month',
            mode: 'including_current',
          },
          confidence: 0.96,
          requiresClarification: false,
          missingFields: [],
        }),
      },
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => responsePayload,
    });

    const result = await service.evaluate(
      'deuda de este mes del edificio A',
      buildDeterministicPlan(),
      {
        buildingId: 'building-A',
        currentPage: '/tenant/buildings/building-A/finance',
        previousTurns: [],
      },
    );

    expect(result.consensus).toBe(true);
    expect(result.usedLocalModel).toBe(true);
    expect(result.modelPlan?.intent).toBe('building_debt');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(mockFetch.mock.calls[0]?.[1]?.body ?? '{}');
    expect(requestBody.model).toBe('qwen2.5:3b');
    expect(requestBody.format).toBeDefined();
  });

  it('asks for clarification on period mismatch', async () => {
    const currentDate = new Date();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            intent: 'building_debt',
            scope: 'building',
            entity: {
              buildingAlias: 'A',
              unitAlias: null,
            },
            period: {
              kind: 'accumulated',
              month: null,
              year: null,
              offset: null,
              amount: null,
              unit: null,
              mode: 'unknown',
            },
            confidence: 0.9,
            requiresClarification: false,
            missingFields: [],
          }),
        },
      }),
    });

    const result = await service.evaluate(
      'deuda de este mes del edificio A',
      buildDeterministicPlan({
        filters: { buildingAlias: 'A', buildingToken: 'A', period: currentDate.toISOString().slice(0, 7) },
      }),
      {},
    );

    expect(result.consensus).toBe(false);
    expect(result.mismatchReason).toBe('period');
    expect(result.clarificationMessage).toContain('este mes');
    expect(result.usedLocalModel).toBe(true);
  });

  it('asks for clarification when the local model marks the query as incomplete', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            intent: 'building_debt',
            scope: 'building',
            entity: {
              buildingAlias: 'A',
              unitAlias: null,
            },
            period: {
              kind: 'unknown',
              month: null,
              year: null,
              offset: null,
              amount: null,
              unit: null,
              mode: null,
            },
            confidence: 0.6,
            requiresClarification: true,
            missingFields: ['period'],
          }),
        },
      }),
    });

    const result = await service.evaluate(
      'deuda del condominio',
      buildDeterministicPlan({ filters: { buildingAlias: 'A', buildingToken: 'A', period: undefined } }),
      {},
    );

    expect(result.consensus).toBe(false);
    expect(result.mismatchReason).toBe('clarification');
    expect(result.clarificationMessage).toContain('este mes');
  });

  it('returns clarification when the local model fails', async () => {
    mockFetch.mockRejectedValue(new Error('Ollama down'));

    const result = await service.evaluate(
      'deuda del condominio',
      buildDeterministicPlan({ filters: { buildingAlias: undefined, buildingToken: undefined, period: undefined } }),
      {},
    );

    expect(result.consensus).toBe(false);
    expect(result.mismatchReason).toBe('local_model_failed');
    expect(result.clarificationMessage).toContain('administración');
  });
});
