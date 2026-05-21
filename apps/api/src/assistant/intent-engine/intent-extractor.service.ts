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
const OPENCODE_TIMEOUT_MS = 5000;
const OPENCODE_BASE_URL = 'https://api.opencode.ai/v1/chat/completions';
const OPENCODE_MODEL = 'qwen3.6-plus';

/**
 * Minimum confidence threshold for LLM extraction
 */
const CONFIDENCE_THRESHOLD = 0.7;

/**
 * IntentExtractorService - Extracts structured intents from natural language
 *
 * Fallback chain:
 * 1. Ollama (llama3.1) - 3s timeout
 * 2. Opencode Go API (qwen3.6-plus) - 5s timeout
 * 3. Deterministic keyword matching via QueryPlanService
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

    this.logger.log(`[EXTRACTOR] Starting extraction for: "${message}"`);

    // Step 1: Try deterministic keyword matching first (fast, reliable, no hallucinations)
    try {
      this.logger.log(`[EXTRACTOR] Step 1: Trying deterministic...`);
      const result = await this.tryDeterministic(message, context);
      const durationMs = performance.now() - startTime;
      this.logSuccess(result.intent, durationMs, 'deterministic');
      this.logger.log(`[EXTRACTOR] Deterministic SUCCESS: intent=${result.intent} in ${durationMs.toFixed(0)}ms`);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`[EXTRACTOR] Deterministic FAILED: ${lastError.message}`);
    }

    // Step 2: Fallback to Ollama for ambiguous language
    try {
      this.logger.log(`[EXTRACTOR] Step 2: Trying Ollama...`);
      const result = await this.tryOllama(message, context);
      const durationMs = performance.now() - startTime;
      this.logSuccess(result.intent, durationMs, 'ollama');
      this.logger.log(`[EXTRACTOR] Ollama SUCCESS: intent=${result.intent} in ${durationMs.toFixed(0)}ms`);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`[EXTRACTOR] Ollama FAILED: ${lastError.message}`);
    }

    // Step 3: Final fallback to Opencode Go API
    try {
      this.logger.log(`[EXTRACTOR] Step 3: Trying Opencode...`);
      const result = await this.tryOpencode(message, context);
      const durationMs = performance.now() - startTime;
      this.logSuccess(result.intent, durationMs, 'opencode');
      this.logger.log(`[EXTRACTOR] Opencode SUCCESS: intent=${result.intent} in ${durationMs.toFixed(0)}ms`);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`[EXTRACTOR] Opencode FAILED: ${lastError.message}`);
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

      const data = await response.json() as any;
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

      const data = await response.json() as any;
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
            : plan.scope === 'building'
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
}
