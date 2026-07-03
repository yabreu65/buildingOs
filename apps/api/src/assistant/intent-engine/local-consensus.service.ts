import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { resolveAiConsensusModeConfig } from '../providers/ai-provider.resolver';
import { resolveDevOnlyFallback } from '../assistant-env';
import type { CanonicalFinancePeriod } from '../finance-period.types';
import type {
  AssistantConsensusEvaluation,
  AssistantConsensusIntent,
  AssistantConsensusModelPlan,
} from '../ai.types';
import type { ConversationTurn } from './intent.types';
import type { AssistantQueryPlan } from '../query-plan.types';

const DEFAULT_OLLAMA_TIMEOUT_MS = 20000;
const DEFAULT_OLLAMA_MODEL = 'qwen2.5:3b';

function resolveOllamaTimeoutMs(): number {
  const raw = process.env.AI_OLLAMA_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : DEFAULT_OLLAMA_TIMEOUT_MS;

  if (!Number.isFinite(parsed) || parsed < 1000) {
    return DEFAULT_OLLAMA_TIMEOUT_MS;
  }

  return parsed;
}

const assistantConsensusSchema = z.object({
  intent: z.enum(['tenant_debt', 'building_debt', 'unit_debt', 'unknown']),
  scope: z.enum(['tenant', 'building', 'unit', 'unknown']),
  entity: z.object({
    buildingAlias: z.string().nullable(),
    unitAlias: z.string().nullable(),
  }).strict(),
  period: z.object({
    kind: z.enum([
      'current_month',
      'previous_month',
      'named_month',
    'relative_month',
    'relative_range',
    'month_range',
    'year_to_date',
    'accumulated',
    'unknown',
  ]),
    month: z.number().int().nullable(),
    year: z.number().int().nullable(),
    offset: z.number().int().nullable(),
    amount: z.number().nullable(),
    unit: z.enum(['month']).nullable(),
    mode: z.enum(['including_current', 'closed_months', 'unknown']).nullable(),
  }).strict(),
  confidence: z.number().min(0).max(1),
  requiresClarification: z.boolean(),
  missingFields: z.array(z.string()),
}).strict();

const ollamaChatSchema = z.object({
  message: z.object({
    content: z.string().optional(),
  }).optional(),
}).passthrough();

interface LocalConsensusContext {
  buildingId?: string;
  unitId?: string;
  currentPage?: string;
  financePeriod?: string;
  previousTurns?: ConversationTurn[];
}

interface ConsensusComparisonResult {
  consensus: boolean;
  mismatchReason?: string;
  clarificationMessage?: string;
}

function normalizeAlias(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function isSameAlias(left: string | null, right: string | null): boolean {
  return normalizeAlias(left) === normalizeAlias(right);
}

@Injectable()
export class AssistantLocalConsensusService {
  private readonly logger = new Logger(AssistantLocalConsensusService.name);
  private readonly config = resolveAiConsensusModeConfig();
  private readonly baseUrl = this.config.ollamaBaseUrl
    || resolveDevOnlyFallback(
      process.env.OLLAMA_BASE_URL || process.env.AI_OLLAMA_URL,
      'http://localhost:11434',
      'AI_OLLAMA_URL or OLLAMA_BASE_URL',
    );
  private readonly model = this.config.ollamaModel
    || resolveDevOnlyFallback(
      process.env.OLLAMA_MODEL || process.env.AI_OLLAMA_MODEL,
      DEFAULT_OLLAMA_MODEL,
      'AI_OLLAMA_MODEL or OLLAMA_MODEL',
    );
  private readonly timeoutMs = resolveOllamaTimeoutMs();
  private readonly traceEnabled = process.env.ASSISTANT_TRACE === 'true';

  isEnabled(): boolean {
    return this.config.consensusMode || this.config.alwaysCallLocalModel;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getModel(): string {
    return this.model;
  }

  getTimeoutMs(): number {
    return this.timeoutMs;
  }

  async evaluate(
    message: string,
    deterministicPlan: AssistantQueryPlan | null,
    context: LocalConsensusContext,
  ): Promise<AssistantConsensusEvaluation> {
    const deterministicConsensusPlan = this.toConsensusPlan(deterministicPlan);
    if (!deterministicConsensusPlan) {
      return {
        consensus: false,
        deterministicPlan: null,
        modelPlan: null,
        mismatchReason: 'no_deterministic_plan',
        clarificationMessage: this.buildClarificationMessage('no_deterministic_plan'),
        usedLocalModel: false,
        localProvider: 'ollama',
        localBaseUrl: this.baseUrl,
        localModel: this.model,
      };
    }

    try {
      const modelPlan = await this.callOllama(message, context);
      const normalizedModelPlan = this.normalizeModelPlan(modelPlan, deterministicConsensusPlan);
      const modelValidation = this.validateModelPlan(normalizedModelPlan);
      if (!modelValidation.valid) {
        const invalidReason = modelValidation.reason ?? 'model_semantic_invalid';
        this.logger.warn(`[AssistantConsensus] model invalid=${invalidReason}${modelValidation.details ? ` details=${modelValidation.details.join('|')}` : ''}`);
        return {
          consensus: false,
          deterministicPlan: deterministicConsensusPlan,
          modelPlan: normalizedModelPlan,
          mismatchReason: invalidReason,
          modelValid: false,
          modelInvalidReason: invalidReason,
          clarificationMessage: this.buildClarificationMessage(invalidReason, deterministicConsensusPlan, normalizedModelPlan),
          usedLocalModel: true,
          localProvider: 'ollama',
          localBaseUrl: this.baseUrl,
          localModel: this.model,
        };
      }

      const comparison = this.comparePlans(deterministicConsensusPlan, normalizedModelPlan);

      this.logger.log(
        `[AssistantConsensus] deterministic=${this.summarizePlan(deterministicConsensusPlan)} model=${this.summarizePlan(normalizedModelPlan)} consensus=${comparison.consensus}`,
      );

      if (!comparison.consensus && comparison.mismatchReason) {
        this.logger.warn(`[AssistantConsensus] mismatch=${comparison.mismatchReason}`);
      }

      return {
        consensus: comparison.consensus,
        deterministicPlan: deterministicConsensusPlan,
        modelPlan: normalizedModelPlan,
        mismatchReason: comparison.mismatchReason,
        modelValid: true,
        clarificationMessage: comparison.clarificationMessage,
        usedLocalModel: true,
        localProvider: 'ollama',
        localBaseUrl: this.baseUrl,
        localModel: this.model,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[AssistantConsensus] local model failed: ${reason}`);
      return {
        consensus: false,
        deterministicPlan: deterministicConsensusPlan,
        modelPlan: null,
        mismatchReason: 'local_model_failed',
        modelValid: false,
        clarificationMessage: this.buildClarificationMessage('local_model_failed', deterministicConsensusPlan),
        usedLocalModel: true,
        localProvider: 'ollama',
        localBaseUrl: this.baseUrl,
        localModel: this.model,
      };
    }
  }

  private async callOllama(message: string, context: LocalConsensusContext): Promise<AssistantConsensusModelPlan> {
    const controller = new AbortController();
    const startedAt = Date.now();
    let abortedByTimeout = false;
    const timeoutId = setTimeout(() => {
      abortedByTimeout = true;
      controller.abort();
    }, this.timeoutMs);
    const endpoint = `${this.baseUrl.replace(/\/$/, '')}/api/chat`;
    const requestBody = {
      model: this.model,
      messages: [
        {
          role: 'system',
          content: this.buildPrompt(context),
        },
        {
          role: 'user',
          content: message,
        },
      ],
      stream: false,
      options: {
        temperature: 0,
        num_predict: 220,
      },
      format: this.buildSchema(),
    };

    this.trace(
      `[AssistantConsensus] endpoint=${endpoint} model=${this.model} timeoutMs=${this.timeoutMs} payload=${JSON.stringify({
        messageLength: message.length,
        hasBuildingId: Boolean(context.buildingId),
        hasUnitId: Boolean(context.unitId),
        previousTurns: context.previousTurns?.length ?? 0,
        formatKeys: Object.keys(this.buildSchema().properties ?? {}),
      })}`,
    );

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      const durationMs = Date.now() - startedAt;
      this.trace(`[AssistantConsensus] response.ok=${response.ok} durationMs=${durationMs} abortedByTimeout=${abortedByTimeout}`);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}${errorBody ? ` | body=${errorBody}` : ''}`);
      }

      const raw: unknown = await response.json();
      const parsedResponse = ollamaChatSchema.parse(raw);
      const content = parsedResponse.message?.content?.trim();
      this.trace(`[AssistantConsensus] receivedContent=${Boolean(content)} contentLength=${content?.length ?? 0}`);
      if (!content) {
        throw new Error('Invalid Ollama response format: missing message.content');
      }

      let jsonStr = content;
      const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch?.[1]) {
        jsonStr = codeBlockMatch[1];
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(jsonStr);
        this.trace('[AssistantConsensus] jsonParse=ok');
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.trace(`[AssistantConsensus] jsonParse=failed reason=${reason}`);
        throw error;
      }

      const parsed = assistantConsensusSchema.safeParse(parsedJson);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((issue) => issue.message).join(', ');
        this.trace(`[AssistantConsensus] zod=failed issues=${issues}`);
        throw new Error(`Invalid consensus JSON: ${issues}`);
      }

      this.trace(`[AssistantConsensus] zod=ok durationMs=${Date.now() - startedAt}`);

      return parsed.data;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const reason = error instanceof Error ? error.message : String(error);
      this.trace(
        `[AssistantConsensus] failed durationMs=${durationMs} abortedByTimeout=${abortedByTimeout} reason=${reason}`,
      );
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildPrompt(context: LocalConsensusContext): string {
    const turns = (context.previousTurns || []).slice(-3).map((turn) => ({
      role: turn.role,
      message: turn.message,
    }));

    return [
      'You are a strict JSON-only intent planner for BuildingOS finance read-only assistant.',
      'You NEVER answer the user, calculate debt, query databases, or invent business data.',
      'Return only valid JSON matching the provided schema.',
      'Use tenant_debt for administration/global debt questions.',
      'For tenant_debt, entity.buildingAlias and entity.unitAlias must always be null.',
      'Never use buildingId from context to populate tenant_debt aliases.',
      'For tenant_debt without an explicit period, default to accumulated debt.',
      'Use building_debt for building/condominio/edificio debt questions.',
      'Use unit_debt for apartment/unit debt questions.',
      'Use scope tenant/building/unit to match the intent.',
      'Use period.kind = current_month for "este mes", "mes actual", "mes en curso", "mes corriente", "mes que está corriendo", "del mes actual", "del mes en curso", or "deuda del mes".',
      'Use period.kind = accumulated for "acumulada", "histórica", "total", or "toda" when the user asks for total outstanding debt.',
      'If the query is unclear or missing a critical field, set requiresClarification=true and list the missing fields.',
      `Current date: ${new Date().toISOString().slice(0, 10)}`,
      `Current context: ${JSON.stringify({
        buildingId: context.buildingId ?? null,
        unitId: context.unitId ?? null,
        currentPage: context.currentPage ?? null,
        financePeriod: context.financePeriod ?? null,
        previousTurns: turns,
      })}`,
    ].join('\n');
  }

  private buildSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        intent: { type: 'string', enum: ['tenant_debt', 'building_debt', 'unit_debt', 'unknown'] },
        scope: { type: 'string', enum: ['tenant', 'building', 'unit', 'unknown'] },
        entity: {
          type: 'object',
          additionalProperties: false,
          properties: {
            buildingAlias: { type: ['string', 'null'] },
            unitAlias: { type: ['string', 'null'] },
          },
          required: ['buildingAlias', 'unitAlias'],
        },
        period: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: {
              type: 'string',
              enum: ['current_month', 'previous_month', 'named_month', 'relative_month', 'relative_range', 'month_range', 'accumulated', 'unknown'],
            },
            month: { type: ['integer', 'null'] },
            year: { type: ['integer', 'null'] },
            offset: { type: ['integer', 'null'] },
            amount: { type: ['number', 'null'] },
            unit: { type: ['string', 'null'], enum: ['month', null] },
            mode: { type: ['string', 'null'], enum: ['including_current', 'closed_months', 'unknown', null] },
          },
          required: ['kind', 'month', 'year', 'offset', 'amount', 'unit', 'mode'],
        },
        confidence: { type: 'number' },
        requiresClarification: { type: 'boolean' },
        missingFields: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['intent', 'scope', 'entity', 'period', 'confidence', 'requiresClarification', 'missingFields'],
    } as const;
  }

  private comparePlans(
    deterministic: AssistantConsensusModelPlan,
    model: AssistantConsensusModelPlan,
  ): ConsensusComparisonResult {
    if (deterministic.intent !== model.intent) {
      return {
        consensus: false,
        mismatchReason: 'intent',
        clarificationMessage: this.buildClarificationMessage('intent', deterministic, model),
      };
    }

    if (deterministic.scope !== model.scope) {
      return {
        consensus: false,
        mismatchReason: 'scope',
        clarificationMessage: this.buildClarificationMessage('scope', deterministic, model),
      };
    }

    if (!this.matchEntity(deterministic, model)) {
      return {
        consensus: false,
        mismatchReason: this.entityMismatchReason(deterministic, model),
        clarificationMessage: this.buildClarificationMessage('entity', deterministic, model),
      };
    }

    if (!this.periodsAreCompatible(deterministic.period, model.period, deterministic.intent)) {
      return {
        consensus: false,
        mismatchReason: 'period',
        clarificationMessage: this.buildClarificationMessage('period', deterministic, model),
      };
    }

    if (model.requiresClarification || model.missingFields.length > 0) {
      return {
        consensus: false,
        mismatchReason: 'clarification',
        clarificationMessage: this.buildClarificationMessage('clarification', deterministic, model),
      };
    }

    return { consensus: true };
  }

  private validateModelPlan(
    model: AssistantConsensusModelPlan,
  ): { valid: boolean; reason?: 'model_semantic_invalid' | 'model_intent_scope_conflict'; details?: string[] } {
    const details: string[] = [];

    if (model.intent === 'tenant_debt') {
      if (model.scope !== 'tenant') {
        details.push('tenant_debt_scope');
      }
      if (normalizeAlias(model.entity.buildingAlias) || normalizeAlias(model.entity.unitAlias)) {
        details.push('tenant_debt_entity');
      }
    }

    if (model.intent === 'building_debt') {
      if (model.scope !== 'building') {
        details.push('building_debt_scope');
      }
      if (!normalizeAlias(model.entity.buildingAlias)) {
        details.push('building_debt_building_alias');
      }
      if (normalizeAlias(model.entity.unitAlias)) {
        details.push('building_debt_unit_alias');
      }
    }

    if (model.intent === 'unit_debt') {
      if (model.scope !== 'unit') {
        details.push('unit_debt_scope');
      }
      if (!normalizeAlias(model.entity.unitAlias)) {
        details.push('unit_debt_unit_alias');
      }
    }

    if (model.period.kind === 'month_range' && typeof model.period.amount === 'number' && model.period.amount <= 0) {
      details.push('month_range_amount');
    }

    if (details.length === 0) {
      return { valid: true };
    }

    const intentScopeConflict = details.some((detail) =>
      detail.endsWith('_scope') || detail.endsWith('_entity'),
    );

    return {
      valid: false,
      reason: intentScopeConflict ? 'model_intent_scope_conflict' : 'model_semantic_invalid',
      details,
    };
  }

  private matchEntity(deterministic: AssistantConsensusModelPlan, model: AssistantConsensusModelPlan): boolean {
    if (deterministic.scope === 'tenant') {
      return normalizeAlias(deterministic.entity.buildingAlias) === normalizeAlias(model.entity.buildingAlias)
        && normalizeAlias(deterministic.entity.unitAlias) === normalizeAlias(model.entity.unitAlias);
    }

    if (deterministic.scope === 'building') {
      return isSameAlias(deterministic.entity.buildingAlias, model.entity.buildingAlias)
        && normalizeAlias(deterministic.entity.unitAlias) === normalizeAlias(model.entity.unitAlias);
    }

    if (deterministic.scope === 'unit') {
      return isSameAlias(deterministic.entity.buildingAlias, model.entity.buildingAlias)
        && isSameAlias(deterministic.entity.unitAlias, model.entity.unitAlias);
    }

    return true;
  }

  private periodsAreCompatible(
    deterministic: AssistantConsensusModelPlan['period'],
    model: AssistantConsensusModelPlan['period'],
    intent?: AssistantConsensusIntent,
  ): boolean {
    if (deterministic.kind === model.kind) {
      return true;
    }

    if (deterministic.kind === 'unknown' || model.kind === 'unknown') {
      return true;
    }

    if (
      intent === 'tenant_debt' &&
      (
        (deterministic.kind === 'accumulated' && model.kind === 'current_month') ||
        (deterministic.kind === 'current_month' && model.kind === 'accumulated')
      )
    ) {
      return true;
    }

    if (this.isCurrentMonthPeriod(deterministic) && this.isCurrentMonthPeriod(model)) {
      return true;
    }

    return false;
  }

  private isCurrentMonthPeriod(period: AssistantConsensusModelPlan['period']): boolean {
    if (period.kind === 'current_month') {
      return true;
    }

    if (period.kind === 'named_month' && period.month && period.year) {
      const current = new Date();
      return period.year === current.getFullYear() && period.month === current.getMonth() + 1;
    }

    return false;
  }

  private entityMismatchReason(deterministic: AssistantConsensusModelPlan, model: AssistantConsensusModelPlan): string {
    if (deterministic.scope === 'unit' && !isSameAlias(deterministic.entity.unitAlias, model.entity.unitAlias)) {
      return 'unit_alias';
    }

    if (deterministic.scope !== 'tenant' && !isSameAlias(deterministic.entity.buildingAlias, model.entity.buildingAlias)) {
      return 'building_alias';
    }

    return 'entity';
  }

  private buildClarificationMessage(
    mismatch: string,
    deterministic?: AssistantConsensusModelPlan | null,
    model?: AssistantConsensusModelPlan | null,
  ): string {
    if (mismatch === 'local_model_failed') {
      if (deterministic?.scope === 'building') {
        const buildingAlias = deterministic.entity.buildingAlias || model?.entity.buildingAlias;
        if (buildingAlias) {
          return `No pude validar esa consulta con el modelo local para el edificio ${buildingAlias}. ¿Querés la deuda de este mes o la deuda acumulada?`;
        }
        return 'No pude validar esa consulta con el modelo local. ¿Querés aclarar si se trata de una deuda de la administración, de un edificio o de una unidad?';
      }
      return 'No pude validar esa consulta con el modelo local. ¿Querés aclarar si se trata de una deuda de la administración, de un edificio o de una unidad?';
    }

    if (mismatch === 'model_semantic_invalid' || mismatch === 'model_intent_scope_conflict') {
      if (deterministic?.scope === 'building') {
        const buildingAlias = deterministic.entity.buildingAlias || model?.entity.buildingAlias;
        if (buildingAlias) {
          return `El modelo local devolvió una combinación inválida para el edificio ${buildingAlias}. ¿Querés la deuda de este mes o la deuda acumulada?`;
        }
        return 'El modelo local devolvió una combinación inválida. ¿De cuál condominio o edificio querés consultar la deuda?';
      }

      if (deterministic?.scope === 'unit') {
        return 'El modelo local devolvió una combinación inválida. ¿De qué unidad querés consultar la deuda?';
      }

      if (deterministic?.scope === 'tenant') {
        return 'El modelo local devolvió una combinación inválida. ¿Querés la deuda de la administración o la deuda total?';
      }

      return 'El modelo local devolvió una combinación inválida. ¿Querés aclarar la consulta?';
    }

    if (mismatch === 'no_deterministic_plan') {
      return 'No pude identificar una consulta financiera clara. ¿Querés aclarar si se trata de una deuda de la administración, de un edificio o de una unidad?';
    }

    if (mismatch === 'period') {
      if (deterministic?.period.kind === 'relative_range') {
        const amount = deterministic.period.amount ?? model?.period.amount ?? 0;
        return `¿Querés incluir el mes actual o consultar solo los últimos ${amount} meses cerrados?`;
      }
      const buildingAlias = deterministic?.entity.buildingAlias || model?.entity.buildingAlias;
      if (buildingAlias) {
        return `Entiendo que quieres consultar la deuda del edificio ${buildingAlias}. ¿Te refieres a este mes o a la deuda acumulada?`;
      }
      return '¿Te refieres a la deuda de este mes o a la deuda acumulada?';
    }

    if (mismatch === 'clarification') {
      const missingFields = model?.missingFields ?? [];
      if (deterministic?.period.kind === 'relative_range' || missingFields.includes('period.mode')) {
        const amount = deterministic?.period.amount ?? model?.period.amount ?? 0;
        return `¿Querés incluir el mes actual o consultar solo los últimos ${amount} meses cerrados?`;
      }
      if (missingFields.includes('period')) {
        return '¿Te refieres a la deuda de este mes o a la deuda acumulada?';
      }
      if (missingFields.includes('building')) {
        return '¿De cuál condominio o edificio querés consultar la deuda?';
      }
      if (missingFields.includes('unit')) {
        return '¿De qué unidad querés consultar la deuda?';
      }
      return 'Necesito más contexto para responder con precisión.';
    }

    if (mismatch === 'building_alias' || mismatch === 'entity') {
      return '¿De cuál condominio o edificio querés consultar la deuda?';
    }

    if (mismatch === 'unit_alias') {
      return '¿De qué unidad querés consultar la deuda?';
    }

    return 'Necesito más contexto para responder con precisión.';
  }

  private toConsensusPlan(plan: AssistantQueryPlan | null): AssistantConsensusModelPlan | null {
    if (!plan) {
      return null;
    }

    return {
      intent: plan.intent as AssistantConsensusIntent,
      scope: plan.scope,
      entity: {
        buildingAlias: normalizeAlias(plan.filters.buildingAlias ?? plan.filters.buildingToken ?? null),
        unitAlias: normalizeAlias(plan.filters.unitCode ?? plan.filters.unitCodeRaw ?? null),
      },
      period: this.mapDeterministicPeriod(plan.filters.period),
      confidence: plan.confidence,
      requiresClarification: false,
      missingFields: [],
    };
  }

  private mapDeterministicPeriod(period?: string | CanonicalFinancePeriod): AssistantConsensusModelPlan['period'] {
    if (!period) {
      return {
        kind: 'unknown',
        month: null,
        year: null,
        offset: null,
        amount: null,
        unit: null,
        mode: null,
      };
    }

    if (typeof period !== 'string') {
      return {
        kind: period.kind,
        month: period.month,
        year: period.year,
        offset: period.kind === 'relative_range' ? 0 : null,
        amount: period.amount,
        unit: period.unit,
        mode: period.mode,
      };
    }

    if (period === 'accumulated') {
      return {
        kind: 'accumulated',
        month: null,
        year: null,
        offset: null,
        amount: null,
        unit: null,
        mode: 'unknown',
      };
    }

    const current = new Date();
    const currentMonth = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;

    if (period === 'current_month' || period === currentMonth) {
      return {
        kind: 'current_month',
        month: current.getMonth() + 1,
        year: current.getFullYear(),
        offset: 0,
        amount: null,
        unit: 'month',
        mode: 'including_current',
      };
    }

    const monthMatch = period.match(/^(\d{4})-(\d{2})$/);
    if (monthMatch) {
      const year = Number(monthMatch[1]);
      const month = Number(monthMatch[2]);
      const isCurrentMonth = year === current.getFullYear() && month === current.getMonth() + 1;
      return {
        kind: isCurrentMonth ? 'current_month' : 'named_month',
        month,
        year,
        offset: null,
        amount: null,
        unit: 'month',
        mode: isCurrentMonth ? 'including_current' : 'closed_months',
      };
    }

    return {
      kind: 'unknown',
      month: null,
      year: null,
      offset: null,
      amount: null,
      unit: null,
      mode: null,
    };
  }

  private normalizeModelPlan(
    model: AssistantConsensusModelPlan,
    deterministicPlan: AssistantConsensusModelPlan,
  ): AssistantConsensusModelPlan {
    const normalized: AssistantConsensusModelPlan = {
      ...model,
      entity: {
        buildingAlias: model.intent === 'tenant_debt' || model.scope === 'tenant'
          ? null
          : model.entity.buildingAlias,
        unitAlias: model.intent === 'tenant_debt' || model.scope === 'tenant'
          ? null
          : model.entity.unitAlias,
      },
    };

    if (normalized.period.kind === 'relative_range') {
      normalized.missingFields = this.normalizeRelativeRangeMissingFields(normalized);
    }

    if (
      deterministicPlan.intent === 'tenant_debt' &&
      deterministicPlan.period.kind === 'accumulated' &&
      normalized.intent === 'tenant_debt' &&
      normalized.scope === 'tenant' &&
      normalized.period.kind === 'current_month'
    ) {
      normalized.period = {
        kind: 'accumulated',
        month: null,
        year: null,
        offset: null,
        amount: null,
        unit: null,
        mode: 'unknown',
      };
    }

    return normalized;
  }

  private normalizeRelativeRangeMissingFields(model: AssistantConsensusModelPlan): string[] {
    const normalized = new Set<string>();
    for (const field of model.missingFields) {
      if (field === 'startMonth' || field === 'endMonth' || field === 'period.mode') {
        normalized.add('period.mode');
        continue;
      }
      normalized.add(field);
    }

    if (model.period.mode === 'unknown' && normalized.size === 0) {
      normalized.add('period.mode');
    }

    return Array.from(normalized);
  }

  private summarizePlan(plan: AssistantConsensusModelPlan | null): string {
    if (!plan) {
      return 'none';
    }

    const building = plan.entity.buildingAlias ?? '-';
    const unit = plan.entity.unitAlias ?? '-';
    return `${plan.intent}/${plan.scope}/${plan.period.kind}/${building}/${unit}`;
  }

  private trace(message: string): void {
    if (this.traceEnabled) {
      this.logger.debug(message);
    }
  }
}
