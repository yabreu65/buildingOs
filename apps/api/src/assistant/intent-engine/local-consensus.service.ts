import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { resolveAiConsensusModeConfig } from '../providers/ai-provider.resolver';
import type {
  AssistantConsensusEvaluation,
  AssistantConsensusIntent,
  AssistantConsensusModelPlan,
} from '../ai.types';
import type { ConversationTurn } from './intent.types';
import type { AssistantQueryPlan } from '../query-plan.types';

const OLLAMA_TIMEOUT_MS = 8000;
const DEFAULT_OLLAMA_MODEL = 'qwen2.5:3b';

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
  private readonly baseUrl = this.config.ollamaBaseUrl || process.env.OLLAMA_BASE_URL || process.env.AI_OLLAMA_URL || 'http://localhost:11434';
  private readonly model = this.config.ollamaModel || process.env.OLLAMA_MODEL || process.env.AI_OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;

  isEnabled(): boolean {
    return this.config.consensusMode || this.config.alwaysCallLocalModel;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getModel(): string {
    return this.model;
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
      const comparison = this.comparePlans(deterministicConsensusPlan, modelPlan);

      this.logger.log(
        `[AssistantConsensus] deterministic=${this.summarizePlan(deterministicConsensusPlan)} model=${this.summarizePlan(modelPlan)} consensus=${comparison.consensus}`,
      );

      if (!comparison.consensus && comparison.mismatchReason) {
        this.logger.warn(`[AssistantConsensus] mismatch=${comparison.mismatchReason}`);
      }

      return {
        consensus: comparison.consensus,
        deterministicPlan: deterministicConsensusPlan,
        modelPlan,
        mismatchReason: comparison.mismatchReason,
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
    const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
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

    this.logger.debug(
      `[AssistantConsensus] endpoint=${endpoint} model=${this.model} payload=${JSON.stringify({
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

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}${errorBody ? ` | body=${errorBody}` : ''}`);
      }

      const raw: unknown = await response.json();
      const parsedResponse = ollamaChatSchema.parse(raw);
      const content = parsedResponse.message?.content?.trim();
      if (!content) {
        throw new Error('Invalid Ollama response format: missing message.content');
      }

      let jsonStr = content;
      const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch?.[1]) {
        jsonStr = codeBlockMatch[1];
      }

      const parsed = assistantConsensusSchema.safeParse(JSON.parse(jsonStr));
      if (!parsed.success) {
        const issues = parsed.error.issues.map((issue) => issue.message).join(', ');
        throw new Error(`Invalid consensus JSON: ${issues}`);
      }

      return parsed.data;
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
      'Use building_debt for building/condominio/edificio debt questions.',
      'Use unit_debt for apartment/unit debt questions.',
      'Use scope tenant/building/unit to match the intent.',
      'Use period.kind = current_month for "este mes", "mes actual", "mes en curso", or "del mes actual".',
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

    if (deterministic.period.kind !== model.period.kind) {
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
      return 'No pude validar esa consulta con el modelo local. ¿Querés aclarar si se trata de una deuda de la administración, de un edificio o de una unidad?';
    }

    if (mismatch === 'no_deterministic_plan') {
      return 'No pude identificar una consulta financiera clara. ¿Querés aclarar si se trata de una deuda de la administración, de un edificio o de una unidad?';
    }

    if (mismatch === 'period') {
      const buildingAlias = deterministic?.entity.buildingAlias || model?.entity.buildingAlias;
      if (buildingAlias) {
        return `Entiendo que quieres consultar la deuda del edificio ${buildingAlias}. ¿Te refieres a este mes o a la deuda acumulada?`;
      }
      return '¿Te refieres a la deuda de este mes o a la deuda acumulada?';
    }

    if (mismatch === 'clarification') {
      const missingFields = model?.missingFields ?? [];
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

  private mapDeterministicPeriod(period?: string): AssistantConsensusModelPlan['period'] {
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

  private summarizePlan(plan: AssistantConsensusModelPlan | null): string {
    if (!plan) {
      return 'none';
    }

    const building = plan.entity.buildingAlias ?? '-';
    const unit = plan.entity.unitAlias ?? '-';
    return `${plan.intent}/${plan.scope}/${plan.period.kind}/${building}/${unit}`;
  }
}
