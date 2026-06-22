import { IntentSemanticValidatorService } from './intent-semantic-validator.service';
import type { ExtractedIntent } from './intent-engine/intent.types';
import type { AssistantQueryPlan } from './query-plan.types';

describe('IntentSemanticValidatorService', () => {
  let service: IntentSemanticValidatorService;

  beforeEach(() => {
    jest.restoreAllMocks();
    service = new IntentSemanticValidatorService();
    delete process.env.AI_PROVIDER;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
  });

  function buildExtractedIntent(overrides: Partial<ExtractedIntent> = {}): ExtractedIntent {
    return {
      intent: 'building_debt',
      entity: { type: 'building', buildingAlias: 'B' },
      filters: {},
      confidence: 0.9,
      source: 'deterministic',
      llmProvider: 'none',
      requiresClarification: false,
      missingFields: [],
      ...overrides,
    };
  }

  function buildPlan(overrides: Partial<AssistantQueryPlan> = {}): AssistantQueryPlan {
    return {
      intent: 'building_debt',
      module: 'payments',
      scope: 'building',
      requiredPermission: 'payments.review',
      executor: 'building_debt',
      filters: { buildingAlias: 'B', buildingToken: 'B' },
      confidence: 0.9,
      source: 'deterministic_rules',
      ...overrides,
    };
  }

  it('accepts explicit accumulated debt without forcing a period', async () => {
    const result = await service.evaluate({
      userText: 'deuda acumulada edificio B',
      deterministicPlan: buildPlan(),
      extractedIntent: buildExtractedIntent(),
      assistantContext: {},
    });

    expect(result).toEqual({
      status: 'accepted',
      reason: 'explicit_accumulated_debt',
    });
  });

  it('asks for clarification when total building debt has no period or safe context', async () => {
    const result = await service.evaluate({
      userText: 'deuda total edificio B',
      deterministicPlan: buildPlan(),
      extractedIntent: buildExtractedIntent(),
      assistantContext: {},
    });

    expect(result.status).toBe('needs_clarification');
    expect(result.reason).toBe('period_ambiguous');
    expect(result.question).toContain('este mes');
  });

  it('uses finance context period instead of historical debt when available', async () => {
    const result = await service.evaluate({
      userText: 'deuda total edificio B',
      deterministicPlan: buildPlan(),
      extractedIntent: buildExtractedIntent(),
      assistantContext: {
        currentPage: '/tenant-1/buildings/demo-B/finance',
        page: 'charges',
        financePeriod: '2026-06',
        buildingId: 'demo-B',
      },
    });

    expect(result).toEqual({
      status: 'override_suggested',
      reason: 'finance_context_period',
      filterOverrides: {
        period: '2026-06',
        financePeriod: '2026-06',
      },
    });
  });

  it('does not trust Gemini to override to a conflicting intent', async () => {
    process.env.AI_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_MODEL = 'gemini-2.5-flash-lite';

    jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    status: 'override_suggested',
                    reason: 'llm_conflict',
                    intent: 'unit_debt',
                    entity: { type: 'unit', unitCode: '2026' },
                    filters: { period: '2026-06' },
                  }),
                },
              ],
            },
          },
        ],
      }),
    } as Response);

    const result = await service.evaluate({
      userText: 'deuda del edificio B, del mes actual',
      deterministicPlan: buildPlan(),
      extractedIntent: buildExtractedIntent(),
      assistantContext: {},
    });

    expect(result.status).toBe('needs_clarification');
    expect(result.reason).toBe('parser_llm_conflict');
  });

  it('ignores Gemini payloads that try to introduce numeric debt calculations', async () => {
    process.env.AI_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'test-key';

    jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    status: 'override_suggested',
                    reason: 'unsafe_numeric_override',
                    filters: { period: '2026-06', minAmount: 474568 },
                  }),
                },
              ],
            },
          },
        ],
      }),
    } as Response);

    const result = await service.evaluate({
      userText: 'deuda del edificio B, del mes actual',
      deterministicPlan: buildPlan(),
      extractedIntent: buildExtractedIntent(),
      assistantContext: {},
    });

    expect(result.status).toBe('needs_clarification');
    expect(result.reason).toBe('period_signal_missing');
  });
});
