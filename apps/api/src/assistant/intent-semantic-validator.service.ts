import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { ExtractedIntent } from './intent-engine/intent.types';
import type { AssistantQueryIntent, AssistantQueryPlan } from './query-plan.types';

export interface AssistantSemanticContext {
  readonly page?: string;
  readonly currentPage?: string;
  readonly buildingId?: string;
  readonly unitId?: string;
  readonly financePeriod?: string;
}

export interface IntentSemanticValidationInput {
  readonly userText: string;
  readonly deterministicPlan: AssistantQueryPlan | null;
  readonly extractedIntent: ExtractedIntent;
  readonly assistantContext: AssistantSemanticContext;
}

export interface IntentSemanticValidationResult {
  readonly status: 'accepted' | 'needs_clarification' | 'override_suggested';
  readonly reason: string;
  readonly question?: string;
  readonly intentOverride?: AssistantQueryIntent;
  readonly entityOverride?: Partial<ExtractedIntent['entity']>;
  readonly filterOverrides?: Partial<ExtractedIntent['filters']>;
  readonly llmProvider?: 'gemini';
}

const GEMINI_TIMEOUT_MS = 4000;
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';

const semanticGeminiSchema = z.object({
  status: z.enum(['accepted', 'needs_clarification', 'override_suggested']),
  reason: z.string().min(1),
  question: z.string().optional(),
  intent: z.enum([
    'unit_residents',
    'unit_debt',
    'unit_documents',
    'unit_tickets',
    'unit_payments',
    'building_debt',
    'building_delinquents',
    'building_documents',
    'building_tickets',
    'building_payments',
    'building_stats',
  ]).optional(),
  entity: z.object({
    type: z.enum(['unit', 'building', 'person']).optional(),
    buildingAlias: z.string().optional(),
    unitCode: z.string().optional(),
  }).strict().optional(),
  filters: z.object({
    period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    financePeriod: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  }).strict().optional(),
}).strict();

@Injectable()
export class IntentSemanticValidatorService {
  private readonly logger = new Logger(IntentSemanticValidatorService.name);
  private readonly geminiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  async evaluate(input: IntentSemanticValidationInput): Promise<IntentSemanticValidationResult> {
    const normalized = this.normalize(input.userText);
    const assistantContext = input.assistantContext;
    const explicitBuildingAlias =
      input.extractedIntent.entity.buildingAlias ??
      input.deterministicPlan?.filters.buildingAlias ??
      input.deterministicPlan?.filters.buildingToken;
    const period = input.extractedIntent.filters.period ?? input.deterministicPlan?.filters.period;
    const isBuildingDebt = input.extractedIntent.intent === 'building_debt';
    const wantsAccumulatedDebt = /\b(acumulad[ao]s?|historic[ao]s?|hist[oó]rica|hist[oó]rico)\b/.test(normalized);
    const hasTemporalSignals = this.detectTemporalSignals(normalized);
    const isFinanceContext = this.isFinanceContext(assistantContext);
    const conflictingYearUnit = this.detectYearAsUnitConflict(input, explicitBuildingAlias, period);

    if (conflictingYearUnit) {
      const mappedIntent = this.mapToBuildingIntent(input.extractedIntent.intent);
      if (mappedIntent) {
        return {
          status: 'override_suggested',
          reason: 'year_looked_like_unit_code',
          intentOverride: mappedIntent,
          entityOverride: {
            type: 'building',
            buildingAlias: explicitBuildingAlias,
            unitCode: undefined,
          },
          filterOverrides: period ? { period } : undefined,
        };
      }
    }

    if (!isBuildingDebt) {
      return { status: 'accepted', reason: 'non_building_debt' };
    }

    if (period) {
      return { status: 'accepted', reason: 'period_present' };
    }

    if (wantsAccumulatedDebt) {
      return { status: 'accepted', reason: 'explicit_accumulated_debt' };
    }

    if (isFinanceContext && assistantContext.financePeriod) {
      return {
        status: 'override_suggested',
        reason: 'finance_context_period',
        filterOverrides: {
          period: assistantContext.financePeriod,
          financePeriod: assistantContext.financePeriod,
        },
      };
    }

    if (hasTemporalSignals) {
      const geminiSuggestion = await this.tryGeminiSemanticFallback(input);
      if (geminiSuggestion) {
        return geminiSuggestion;
      }

      return {
        status: 'needs_clarification',
        reason: 'period_signal_missing',
        question: '¿Querés la deuda de este mes o la deuda acumulada?',
      };
    }

    return {
      status: 'needs_clarification',
      reason: 'period_ambiguous',
      question: '¿Querés la deuda de este mes o la deuda acumulada?',
    };
  }

  private detectTemporalSignals(normalized: string): boolean {
    return (
      /\b(este mes|mes actual|mes pasado|ultimo mes|último mes|hoy|ayer)\b/.test(normalized) ||
      /\b\d{4}-\d{2}\b/.test(normalized) ||
      /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)(\s+\d{4})?\b/.test(normalized)
    );
  }

  private isFinanceContext(context: AssistantSemanticContext): boolean {
    const route = `${context.currentPage || ''} ${context.page || ''}`.toLowerCase();
    return route.includes('finance') || route.includes('finanzas') || route.includes('charges');
  }

  private detectYearAsUnitConflict(
    input: IntentSemanticValidationInput,
    explicitBuildingAlias: string | undefined,
    period: string | undefined,
  ): boolean {
    const unitCode =
      input.extractedIntent.entity.unitCode ||
      input.deterministicPlan?.filters.unitCode ||
      input.deterministicPlan?.filters.unitCodeRaw;

    return Boolean(
      explicitBuildingAlias &&
      period &&
      unitCode &&
      /^\d{4}$/.test(unitCode) &&
      input.extractedIntent.entity.type === 'unit',
    );
  }

  private mapToBuildingIntent(intent: string): AssistantQueryIntent | undefined {
    const mapping: Partial<Record<string, AssistantQueryIntent>> = {
      unit_debt: 'building_debt',
      unit_payments: 'building_payments',
      unit_tickets: 'building_tickets',
      unit_documents: 'building_documents',
    };

    return mapping[intent];
  }

  private async tryGeminiSemanticFallback(
    input: IntentSemanticValidationInput,
  ): Promise<IntentSemanticValidationResult | null> {
    const provider = (process.env.AI_PROVIDER || '').trim().toLowerCase();
    const apiKey = process.env.GEMINI_API_KEY;

    if (provider !== 'gemini' || !apiKey) {
      return null;
    }

    const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    try {
      const response = await fetch(
        `${this.geminiBaseUrl}/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: this.buildGeminiPrompt(input) }],
            },
            contents: [{ parts: [{ text: input.userText }] }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 220,
              responseMimeType: 'application/json',
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
      }

      const payload = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const raw = payload.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!raw) {
        return null;
      }

      const parsed = semanticGeminiSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        return null;
      }

      const suggestion = parsed.data;
      const deterministicIntent = input.deterministicPlan?.intent ?? input.extractedIntent.intent;
      if (suggestion.intent && suggestion.intent !== deterministicIntent) {
        return {
          status: 'needs_clarification',
          reason: 'parser_llm_conflict',
          question: suggestion.question || 'Necesito confirmar si querés ver la deuda de este mes o la deuda acumulada.',
        };
      }

      if (suggestion.status === 'override_suggested' && suggestion.filters?.period) {
        return {
          status: 'override_suggested',
          reason: suggestion.reason,
          question: suggestion.question,
          intentOverride: suggestion.intent,
          entityOverride: suggestion.entity,
          filterOverrides: suggestion.filters,
          llmProvider: 'gemini',
        };
      }

      if (suggestion.status === 'needs_clarification') {
        return {
          status: 'needs_clarification',
          reason: suggestion.reason,
          question: suggestion.question || 'Necesito más contexto para responder con seguridad.',
          llmProvider: 'gemini',
        };
      }

      return { status: 'accepted', reason: suggestion.reason, llmProvider: 'gemini' };
    } catch (error) {
      this.logger.warn(
        `Semantic Gemini fallback failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildGeminiPrompt(input: IntentSemanticValidationInput): string {
    const planSummary = JSON.stringify({
      deterministicIntent: input.deterministicPlan?.intent ?? null,
      deterministicFilters: input.deterministicPlan?.filters ?? {},
      extractedIntent: {
        intent: input.extractedIntent.intent,
        entity: input.extractedIntent.entity,
        filters: input.extractedIntent.filters,
      },
      assistantContext: input.assistantContext,
    });

    return [
      'You validate assistant intent semantics for BuildingOS.',
      'You MUST NOT calculate money, totals, balances, debt, or any numeric business result.',
      'You ONLY decide whether the extracted intent/filters are safe, need clarification, or should be overridden with safer filters.',
      'Return JSON only.',
      'Allowed filter overrides: period, financePeriod.',
      'If the extracted meaning conflicts with the parser, prefer clarification instead of execution.',
      'If the user clearly asks for current month debt, add a YYYY-MM period override when possible.',
      `Current analysis context: ${planSummary}`,
    ].join('\n');
  }

  private normalize(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }
}
