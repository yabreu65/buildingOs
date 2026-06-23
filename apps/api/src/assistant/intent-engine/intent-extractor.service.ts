import { Injectable, Logger } from '@nestjs/common';
import { OllamaProvider } from '../ollama.provider';
import { AssistantQueryPlanService } from '../query-plan.service';
import { AssistantFeedbackService } from '../feedback/assistant-feedback.service';
import { ExtractedIntent, ConversationContext, ConversationTurn } from './intent.types';
import { extractedIntentSchema, validateExtractedIntent } from './intent.schema';
import { FilterCoverageValidator } from './filter-coverage.validator';

/**
 * Timeout configuration for LLM calls
 */
const OLLAMA_TIMEOUT_MS = 15000;
const GEMINI_TIMEOUT_MS = 5000;
const OPENCODE_TIMEOUT_MS = 5000;
const OPENCODE_BASE_URL = 'https://api.opencode.ai/v1/chat/completions';
const OPENCODE_MODEL = 'qwen3.6-plus';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';

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

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

interface OpencodeChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
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
 * 2. Configured semantic LLM fallback (Gemini when AI_PROVIDER=gemini, otherwise Ollama)
 * 3. Secondary fallback provider (Ollama or Opencode when configured)
 *
 * NEVER includes tenantId, roles, or permissions in LLM prompts.
 */
@Injectable()
export class IntentExtractorService {
  private readonly logger = new Logger(IntentExtractorService.name);
  private readonly ollamaUrl = process.env.AI_OLLAMA_URL || 'http://localhost:11434';
  private readonly ollamaModel = process.env.AI_OLLAMA_MODEL || 'llama3:latest';

  constructor(
    private readonly ollamaProvider: OllamaProvider,
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
    const primaryFallback = this.getPrimaryFallbackProvider();
    const secondaryFallback = this.getSecondaryFallbackProvider(primaryFallback);

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

    const fallbackProviders = this.buildFallbackProviderOrder(primaryFallback, backendBelowThreshold);

    // Step 2+: Fallback to the best available LLM providers
    for (const [index, provider] of fallbackProviders.entries()) {
      try {
        this.logger.log(`[EXTRACTOR] Step ${index + 2}: Trying ${provider}...`);
        const result = await this.tryProvider(provider, message, context);
        const durationMs = performance.now() - startTime;
        this.logSuccess(result.intent, durationMs, provider);
        if (backendResult && provider === 'gemini') {
          this.logBackendComparison(backendResult, result);
        }
        this.logger.log(`[EXTRACTOR] ${this.formatProviderLabel(provider)} SUCCESS: intent=${result.intent} in ${durationMs.toFixed(0)}ms`);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`[EXTRACTOR] ${this.formatProviderLabel(provider)} FAILED: ${lastError.message}`);
      }
    }

    // All fallbacks failed
    const durationMs = performance.now() - startTime;
    this.logError('unknown', durationMs, lastError?.message ?? 'All fallbacks failed');
    this.logger.error(`[EXTRACTOR] ALL FALLBACKS FAILED after ${durationMs.toFixed(0)}ms: ${lastError?.message}`);
    throw new Error(`Failed to extract intent: ${lastError?.message ?? 'All extraction methods failed'}`);
  }

  /**
   * Try extraction via Ollama with timeout
   *
   * Calls Ollama directly instead of OllamaProvider.chat() to use the
   * extractor's system prompt without the provider's general chat wrapper.
   */
  private async tryOllama(message: string, context?: ConversationContext): Promise<ExtractedIntent> {
    const systemPrompt = this.buildPrompt(message, context);
    this.logger.log(`[OLLAMA] Calling Ollama at ${this.ollamaUrl} with timeout ${OLLAMA_TIMEOUT_MS}ms`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      this.logger.error(`[OLLAMA] TIMEOUT after ${OLLAMA_TIMEOUT_MS}ms`);
      controller.abort();
    }, OLLAMA_TIMEOUT_MS);

    const fetchStart = performance.now();

    try {
      const response = await fetch(`${this.ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.ollamaModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message },
          ],
          stream: false,
          options: { num_predict: 120 },
        }),
        signal: controller.signal,
      });

      const fetchDuration = performance.now() - fetchStart;
      this.logger.log(`[OLLAMA] HTTP response in ${fetchDuration.toFixed(0)}ms: status=${response.status}`);

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const raw: unknown = await response.json();
      const data = raw as OllamaChatResponse;
      const answer = data.message?.content ?? '';
      this.logger.log(`[OLLAMA] Raw answer: ${answer.substring(0, 200)}`);

      const parsed = this.parseAndValidate(answer);
      return { ...parsed, llmProvider: 'ollama' };
    } catch (error) {
      const fetchDuration = performance.now() - fetchStart;
      this.logger.error(`[OLLAMA] Error after ${fetchDuration.toFixed(0)}ms: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async tryGemini(message: string, context?: ConversationContext): Promise<ExtractedIntent> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const model = process.env.GEMINI_MODEL || process.env.AI_GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    const prompt = this.buildPrompt(message, context);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    try {
      const response = await fetch(
        `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
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
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
      }

      const payload: unknown = await response.json();
      const parsed = parseGeminiStructuredIntentResponse(payload);
      return { ...parsed, llmProvider: 'gemini' };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Try extraction via Opencode Go API
   */
  private async tryOpencode(message: string, context?: ConversationContext): Promise<ExtractedIntent> {
    const apiKey = process.env.OPENCODE_API_KEY;
    if (!apiKey) {
      throw new Error('OPENCODE_API_KEY not configured');
    }

    const prompt = this.buildPrompt(message, context);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OPENCODE_TIMEOUT_MS);

    try {
      const response = await fetch(OPENCODE_BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: OPENCODE_MODEL,
          messages: [
            {
              role: 'system',
              content: prompt,
            },
            {
              role: 'user',
              content: message,
            },
          ],
          max_tokens: 200,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Opencode API error: ${response.status} ${response.statusText}`);
      }

      const raw: unknown = await response.json();
      const data = raw as OpencodeChatCompletionResponse;
      const answer = data.choices?.[0]?.message?.content ?? '';

      const parsed = this.parseAndValidate(answer);
      return { ...parsed, llmProvider: 'opencode' };
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

  private async tryProvider(
    provider: 'ollama' | 'opencode' | 'gemini',
    message: string,
    context?: ConversationContext,
  ): Promise<ExtractedIntent> {
    switch (provider) {
      case 'gemini':
        return this.tryGemini(message, context);
      case 'opencode':
        return this.tryOpencode(message, context);
      default:
        return this.tryOllama(message, context);
    }
  }

  private getPrimaryFallbackProvider(): 'ollama' | 'opencode' | 'gemini' {
    const configured = (process.env.AI_PROVIDER || '').trim().toLowerCase();
    if (configured === 'gemini') {
      return 'gemini';
    }
    if (configured === 'opencode') {
      return 'opencode';
    }
    return 'ollama';
  }

  private getSecondaryFallbackProvider(
    primary: 'ollama' | 'opencode' | 'gemini',
  ): 'ollama' | 'opencode' | 'gemini' | null {
    if (primary === 'gemini') {
      return process.env.OPENCODE_API_KEY ? 'opencode' : 'ollama';
    }
    if (primary === 'opencode') {
      return 'ollama';
    }
    if (process.env.OPENCODE_API_KEY) {
      return 'opencode';
    }
    return null;
  }

  private buildFallbackProviderOrder(
    primary: 'ollama' | 'opencode' | 'gemini',
    backendBelowThreshold: boolean,
  ): Array<'ollama' | 'opencode' | 'gemini'> {
    const providers: Array<'ollama' | 'opencode' | 'gemini'> = [];

    if (backendBelowThreshold && process.env.GEMINI_API_KEY) {
      providers.push('gemini');
    }

    providers.push(primary);

    const secondary = this.getSecondaryFallbackProvider(primary);
    if (secondary) {
      providers.push(secondary);
    }

    return [...new Set(providers)];
  }

  private formatProviderLabel(provider: 'ollama' | 'opencode' | 'gemini'): string {
    switch (provider) {
      case 'gemini':
        return 'Gemini';
      case 'opencode':
        return 'Opencode';
      default:
        return 'Ollama';
    }
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
