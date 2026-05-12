import { Injectable, Logger } from '@nestjs/common';
import { OllamaProvider } from '../ollama.provider';
import { AssistantQueryPlanService } from '../query-plan.service';
import { AssistantFeedbackService } from '../feedback/assistant-feedback.service';
import { ExtractedIntent, ConversationContext, ConversationTurn } from './intent.types';
import { extractedIntentSchema, validateExtractedIntent } from './intent.schema';

/**
 * Timeout configuration for LLM calls
 */
const OLLAMA_TIMEOUT_MS = 3000;
const OPENCODE_TIMEOUT_MS = 5000;

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

  constructor(
    private readonly ollamaProvider: OllamaProvider,
    private readonly queryPlanService: AssistantQueryPlanService,
    private readonly feedbackService: AssistantFeedbackService,
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

    // Step 1: Try Ollama first
    try {
      const result = await this.tryOllama(message, context);
      const durationMs = performance.now() - startTime;
      this.logSuccess(result.intent, durationMs, 'ollama');
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      this.logger.debug(`Ollama extraction failed: ${lastError.message}`);
    }

    // Step 2: Fallback to Opencode Go API
    try {
      const result = await this.tryOpencode(message, context);
      const durationMs = performance.now() - startTime;
      this.logSuccess(result.intent, durationMs, 'opencode');
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      this.logger.debug(`Opencode extraction failed: ${lastError.message}`);
    }

    // Step 3: Final fallback to deterministic keyword matching
    try {
      const result = await this.tryDeterministic(message, context);
      const durationMs = performance.now() - startTime;
      this.logSuccess(result.intent, durationMs, 'deterministic');
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      this.logger.debug(`Deterministic extraction failed: ${lastError.message}`);
    }

    // All fallbacks failed
    const durationMs = performance.now() - startTime;
    this.logError('unknown', durationMs, lastError?.message ?? 'All fallbacks failed');
    throw new Error(`Failed to extract intent: ${lastError?.message ?? 'All extraction methods failed'}`);
  }

  /**
   * Try extraction via Ollama with timeout
   */
  private async tryOllama(message: string, context?: ConversationContext): Promise<ExtractedIntent> {
    const prompt = this.buildPrompt(message, context);

    const response = await Promise.race([
      this.ollamaProvider.chat(prompt, { buildingId: context?.buildingId }),
      this.timeoutPromise(OLLAMA_TIMEOUT_MS),
    ]) as Awaited<ReturnType<OllamaProvider['chat']>>;

    return this.parseAndValidate(response.answer);
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
      const response = await fetch('https://api.opencode.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'qwen3.6-plus',
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

      return this.parseAndValidate(answer);
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

    return {
      intent: plan.intent,
      entity: {
        type: plan.scope === 'unit' ? 'unit' : plan.scope === 'building' ? 'building' : 'person',
        buildingAlias: plan.filters.buildingAlias,
        unitCode: plan.filters.unitCode,
      },
      filters: {},
      confidence: plan.confidence,
    };
  }

  /**
   * Build LLM prompt for intent extraction
   */
  private buildPrompt(message: string, context?: ConversationContext): string {
    // NEVER include tenantId, roles, or permissions in the prompt
    let prompt = `Eres un extractor de intenciones para un asistente de administracion de edificios.
Extra la intencion del mensaje del usuario y responde SOLO con JSON valido.

Intenciones disponibles:
- list_payments: listar pagos de una unidad o edificio
- search_tickets: buscar tickets o reclamos
- get_balance: consultar saldo o deuda de una unidad
- list_residents: listar residentes de una unidad
- get_building_stats: obtener estadisticas del edificio

Entidades:
- unit: requiere buildingAlias y unitCode
- building: requiere buildingAlias
- person: puede requerir personName

Filtros disponibles: period, status, minAmount, maxAmount, sortField, sortOrder, limit

Responde SOLO con JSON valido sin markdown:
{"intent":"nombre_intent","entity":{"type":"unit|building|person","buildingAlias":"...","unitCode":"..."},"filters":{},"confidence":0.0-1.0}`;

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
