import { Injectable, Logger } from '@nestjs/common';
import { AssistantQueryPlanService } from '../query-plan.service';
import { AssistantFeedbackService } from '../feedback/assistant-feedback.service';
import { ExtractedIntent, ConversationContext, ConversationTurn } from './intent.types';
import { validateExtractedIntent } from './intent.schema';
import { FilterCoverageValidator } from './filter-coverage.validator';

/**
 * Timeout configuration for LLM calls
 */
const GEMINI_TIMEOUT_MS = 5000;
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

function normalizeGeminiModel(model: string): string {
  const trimmed = model.trim();
  return trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed;
}

export interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

const geminiExtractionResponseSchema = {
  type: 'object',
  properties: {
    intent: { type: 'string' },
    entity: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['unit', 'building', 'person'] },
        buildingAlias: { type: 'string' },
        unitCode: { type: 'string' },
        personName: { type: 'string' },
      },
      required: ['type'],
      additionalProperties: false,
    },
    filters: {
      type: 'object',
      properties: {
        minAmount: { type: 'number' },
        maxAmount: { type: 'number' },
        minDebt: { type: 'number' },
        period: { type: 'string' },
        financePeriod: { type: 'string' },
        status: { type: 'string' },
        method: { type: 'string' },
        minAgeDays: { type: 'number' },
        category: { type: 'string' },
        sortField: { type: 'string' },
        sortOrder: { type: 'string', enum: ['asc', 'desc'] },
        limit: { type: 'number', maximum: 100 },
      },
      additionalProperties: false,
    },
    sort: {
      type: 'object',
      properties: {
        field: { type: 'string' },
        order: { type: 'string', enum: ['asc', 'desc'] },
      },
      additionalProperties: false,
    },
    limit: { type: 'number', maximum: 100 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    source: { type: 'string', enum: ['deterministic', 'llm', 'hybrid'] },
    llmProvider: { type: 'string', enum: ['ollama', 'opencode', 'gemini', 'none'] },
    requiresClarification: { type: 'boolean' },
    missingFields: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['intent', 'entity', 'filters', 'confidence'],
  additionalProperties: false,
} as const;

export function parseGeminiStructuredIntentResponse(response: unknown): ExtractedIntent {
  const rawText = extractGeminiStructuredIntentText(response);

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('Gemini returned non-JSON structured intent response');
  }

  const validation = validateExtractedIntent(parsed);
  if (!validation.success || !validation.data) {
    const issues = validation.error?.issues.map((issue) => issue.message).join(', ') ?? 'unknown validation error';
    throw new Error(`Gemini structured intent validation failed: ${issues}`);
  }

  if (validation.data.confidence < CONFIDENCE_THRESHOLD) {
    throw new Error(`Confidence ${validation.data.confidence} below threshold ${CONFIDENCE_THRESHOLD}`);
  }

  return validation.data;
}

export function extractGeminiStructuredIntentText(response: unknown): string {
  if (!response || typeof response !== 'object') {
    throw new Error('Gemini returned no parseable structured intent response');
  }

  const payload = response as GeminiGenerateContentResponse;
  const candidates = payload.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('Gemini returned no parseable structured intent response');
  }

  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error('Gemini returned no parseable structured intent response');
  }

  const text = parts
    .map((part) => part?.text ?? '')
    .join('')
    .trim();

  if (!text) {
    throw new Error('Gemini returned no parseable structured intent response');
  }

  return text;
}

/**
 * Minimum confidence threshold for LLM extraction
 */
const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Minimum confidence threshold for trusting the backend deterministic result
 * without consulting Gemini.
 */
const BACKEND_CONFIDENCE_THRESHOLD = 0.9;

/**
 * IntentExtractorService - Extracts structured intents from natural language
 *
 * Fallback chain:
 * 1. Deterministic keyword matching
 * 2. Gemini structured fallback when confidence is below the backend threshold
 *
 * NEVER includes tenantId, roles, or permissions in LLM prompts.
 */
@Injectable()
export class IntentExtractorService {
  private readonly logger = new Logger(IntentExtractorService.name);

  constructor(
    private readonly queryPlanService: AssistantQueryPlanService,
    private readonly feedbackService: AssistantFeedbackService,
    private readonly filterCoverageValidator: FilterCoverageValidator,
  ) {}

  /**
   * Extract a structured intent from user message
   *
   * @param message - User's natural language message
   * @param context - Optional conversation context
   * @returns ExtractedIntent validated against schema
   * @throws Error if all fallbacks fail
   */
  async extractIntent(message: string, context?: ConversationContext): Promise<ExtractedIntent> {
    const startTime = performance.now();
    let lastError: Error | null = null;
    let backendResult: ExtractedIntent | null = null;
    let backendBelowThreshold = false;

    this.logger.log(`[EXTRACTOR] Starting extraction for: "${message}"`);
    // Step 1: Try deterministic keyword matching first (fast, reliable, no hallucinations)
    try {
      this.logger.log(`[EXTRACTOR] Step 1: Trying deterministic...`);
      const result = await this.tryDeterministic(message, context);
      const durationMs = performance.now() - startTime;
      this.logSuccess(result.intent, durationMs, 'deterministic');
      this.logger.log(`[EXTRACTOR] Deterministic SUCCESS: intent=${result.intent} in ${durationMs.toFixed(0)}ms`);
      if (result.confidence >= BACKEND_CONFIDENCE_THRESHOLD) {
        return result;
      }

      backendResult = result;
      backendBelowThreshold = true;
      this.logger.log(
        `[EXTRACTOR] Deterministic confidence ${result.confidence.toFixed(2)} below backend threshold ${BACKEND_CONFIDENCE_THRESHOLD}`,
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`[EXTRACTOR] Deterministic FAILED: ${lastError.message}`);
    }

    if ((backendBelowThreshold || lastError) && process.env.GEMINI_API_KEY) {
      try {
        this.logger.log('[EXTRACTOR] Step 2: Trying Gemini...');
        const result = await this.tryGemini(message, context);
        const durationMs = performance.now() - startTime;
        this.logSuccess(result.intent, durationMs, 'gemini');
        if (backendResult) {
          this.logBackendComparison(backendResult, result);
        }
        this.logger.log(`[EXTRACTOR] Gemini SUCCESS: intent=${result.intent} in ${durationMs.toFixed(0)}ms`);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`[EXTRACTOR] Gemini FAILED: ${lastError.message}`);
      }
    }

    // All fallbacks failed
    const durationMs = performance.now() - startTime;
    this.logError('unknown', durationMs, lastError?.message ?? 'All fallbacks failed');
    this.logger.error(`[EXTRACTOR] ALL FALLBACKS FAILED after ${durationMs.toFixed(0)}ms: ${lastError?.message}`);
    throw new Error(`Failed to extract intent: ${lastError?.message ?? 'All extraction methods failed'}`);
  }

  private async tryGemini(message: string, context?: ConversationContext): Promise<ExtractedIntent> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const model = normalizeGeminiModel(
      process.env.GEMINI_MODEL || process.env.AI_GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    );
    const prompt = this.buildPrompt(message, context);
    const endpoint = `${GEMINI_BASE_URL}/models/${model}:generateContent`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    const requestBody = {
      systemInstruction: {
        parts: [{ text: prompt }],
      },
      contents: [{ parts: [{ text: message }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 220,
        responseMimeType: 'application/json',
        responseSchema: geminiExtractionResponseSchema,
      },
    };

    this.logger.debug(
      `[GeminiExtractor] endpoint=${endpoint} model=${model} payload=${JSON.stringify({
        systemInstruction: { parts: [{ textLength: prompt.length }] },
        contents: [{ parts: [{ textLength: message.length }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 220,
          responseMimeType: 'application/json',
          responseSchemaKeys: Object.keys(geminiExtractionResponseSchema.properties ?? {}),
        },
      })}`,
    );

    try {
      const response = await fetch(`${endpoint}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(
          `Gemini API error: ${response.status} ${response.statusText}${errorBody ? ` | body=${errorBody}` : ''}`,
        );
      }

      const payload: unknown = await response.json();
      const parsed = parseGeminiStructuredIntentResponse(payload);
      return { ...parsed, llmProvider: 'gemini' };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Try extraction via deterministic keyword matching
   */
  private async tryDeterministic(message: string, context?: ConversationContext): Promise<ExtractedIntent> {
    const plan = this.queryPlanService.createPlan(message);

    if (!plan) {
      throw new Error('No deterministic plan match');
    }

    const extracted: ExtractedIntent = {
      intent: plan.intent,
      entity: {
        type: plan.filters.personName
          ? 'person'
          : plan.scope === 'unit'
            ? 'unit'
            : plan.scope === 'building' || plan.scope === 'tenant'
              ? 'building'
              : 'person',
        buildingAlias: plan.filters.buildingAlias ?? plan.filters.buildingToken,
        unitCode: plan.filters.unitCode,
        personName: plan.filters.personName,
      },
      filters: {
        minAmount: plan.filters.minAmount,
        maxAmount: plan.filters.maxAmount,
        minDebt: plan.filters.minDebt,
        period: plan.filters.period,
        status: plan.filters.status,
        method: plan.filters.method,
        minAgeDays: plan.filters.minAgeDays,
      },
      confidence: plan.confidence,
      source: 'deterministic',
      llmProvider: 'none',
      requiresClarification: false,
      missingFields: [],
    };

    const coverage = this.filterCoverageValidator.analyze(message, extracted.filters);
    if (!coverage.complete) {
      throw new Error(`Deterministic extraction incomplete: ${coverage.missingFields.join(',')}`);
    }

    return this.parseAndValidate(JSON.stringify(extracted));
  }


  /**
   * Build LLM prompt for intent extraction
   */
  private buildPrompt(message: string, context?: ConversationContext): string {
    // NEVER include tenantId, roles, or permissions in the prompt
    let prompt = `Eres un extractor de intenciones para un asistente de administracion de edificios.
Extrae la intencion del mensaje del usuario y responde SOLO con JSON valido.

Intenciones disponibles:
- unit_residents: listar residentes de una unidad
- unit_debt: consultar saldo o deuda de una unidad
- unit_documents: listar documentos de una unidad
- unit_tickets: buscar tickets o reclamos de una unidad
- unit_payments: listar pagos de una unidad
- building_debt: consultar deuda total de un edificio
- tenant_debt: consultar deuda total de la administracion
- building / condominio / edificio / torre / bloque / building => building_debt
- tenant_debt tambien aplica a frases globales como: deuda administracion, deuda de la administracion, deuda de todos los edificios, deuda de todos los condominios, deuda de todo, morosidad global, saldo general, cuanto deben todos
- Si hay una unidad explicita, prioriza unit_debt.
- Si hay una referencia clara a edificio/condominio, prioriza building_debt.
- Si la frase es ambigua, responde con confianza baja y no inventes el scope.
- building_delinquents: listar morosos de un edificio
- building_documents: listar documentos de un edificio
- building_tickets: buscar tickets de un edificio
- building_payments: listar pagos de un edificio
- building_stats: obtener estadisticas del edificio

Entidades:
- unit: requiere buildingAlias y unitCode (ej: A-0101)
- building: requiere buildingAlias (ej: Torre A)
- person: requiere personName (ej: Juan Perez)

Filtros disponibles: period (YYYY-MM), status, minAmount, maxAmount, method, minAgeDays, sortField, sortOrder, limit

Responde SOLO con JSON valido sin markdown ni comentarios:
{"intent":"nombre_intent","entity":{"type":"unit|building|person","buildingAlias":"A","unitCode":"0101","personName":""},"filters":{},"confidence":0.0-1.0}`;

    if (context?.buildingId) {
      prompt += `\n\nContexto del edificio actual: ${context.buildingId}`;
    }

    if (context?.previousTurns && context.previousTurns.length > 0) {
      const recentContext = context.previousTurns.slice(-3);
      prompt += `\n\nConversacion reciente:\n${recentContext.map((t: ConversationTurn) => `${t.role}: ${t.message}`).join('\n')}`;
    }

    return prompt;
  }

  /**
   * Parse and validate LLM response
   */
  private parseAndValidate(answer: string): ExtractedIntent {
    // Try to extract JSON from response (might be wrapped in markdown)
    let jsonStr = answer.trim();

    // Remove markdown code blocks if present
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      jsonStr = codeBlockMatch[1];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error('Invalid JSON in LLM response');
    }

    // Validate with Zod schema
    const validation = validateExtractedIntent(parsed);
    if (!validation.success) {
      throw new Error(`Validation failed: ${validation.error?.issues.map((i) => i.message).join(', ')}`);
    }

    // Check confidence threshold
    if (validation.data!.confidence < CONFIDENCE_THRESHOLD) {
      throw new Error(`Confidence ${validation.data!.confidence} below threshold ${CONFIDENCE_THRESHOLD}`);
    }

    return validation.data!;
  }

  /**
   * Create a promise that rejects after timeout
   */
  private timeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    });
  }

  /**
   * Log successful extraction
   */
  private logSuccess(intent: string, durationMs: number, source: string): void {
    this.feedbackService.logExecution({
      intent,
      entity: { type: 'building' },
      filters: {},
      success: true,
      durationMs,
      tenantId: '',
      userId: '',
    });
    this.logger.debug(`[IntentExtractor] Extracted "${intent}" via ${source} in ${durationMs.toFixed(2)}ms`);
  }

  /**
   * Log failed extraction
   */
  private logError(intent: string, durationMs: number, error?: string): void {
    this.feedbackService.logExecution({
      intent,
      entity: { type: 'building' },
      filters: {},
      success: false,
      error,
      durationMs,
      tenantId: '',
      userId: '',
    });
    this.logger.warn(`[IntentExtractor] Failed to extract intent: ${error}`);
  }

  private logBackendComparison(backend: ExtractedIntent, llm: ExtractedIntent): void {
    const sameIntent = backend.intent === llm.intent;
    this.logger.log(
      `[EXTRACTOR] Gemini comparison: backend=${backend.intent}(${backend.confidence.toFixed(2)}) vs gemini=${llm.intent}(${llm.confidence.toFixed(2)}), sameIntent=${sameIntent}`,
    );
  }
}
