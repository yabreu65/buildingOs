import { SuggestedAction, SuggestedActionType } from './ai.types';

export type GatewayOutcome =
  | 'success'
  | 'null'
  | 'error'
  | 'missing_entities'
  | 'timeout'
  | 'unavailable'
  | 'invalid_payload'
  | 'contract_mismatch'
  | 'denied'
  | 'invalid_entities'
  | 'cache_hit'
  | 'cache_miss'
  | 'hitl_created';

export type IntentFamily =
  | 'TOP_N'
  | 'BREAKDOWN'
  | 'TOTAL'
  | 'TREND'
  | 'AGING'
  | 'OVERDUE'
  | 'PAYMENT_STATUS'
  | 'PAYMENT_HISTORY'
  | 'LEGACY';

export type CanonicalAssistantResponse = {
  answer: string;
  responseType: 'exact' | 'summary' | 'list' | 'clarification';
  answerSource: 'live_data' | 'knowledge' | 'fallback' | 'snapshot';
  suggestedActions: SuggestedAction[];
  metadata: {
    auditId?: string;
    intentCode?: string;
    traceId?: string;
    timestamp?: string;
    tenantId?: string;
    userId?: string;
    role?: string;
    buildingId?: string;
    unitId?: string;
    resolvedLevel?: 'P0' | 'P1' | 'P2B' | 'P2' | 'P3' | 'FALLBACK';
    resolvedIntentCode?: string;
    familyChosen?: IntentFamily;
    toolName?: string;
    fallbackPath?: string;
    gatewayOutcome: GatewayOutcome;
    missingEntities?: string[];
    defaultsApplied?: string[];
    latencyMsTotal?: number;
    latencyMsRouting?: number;
    latencyMsGateway?: number;
    p0EnforcementEnabled?: boolean;
    p3Enabled?: boolean;
    rawAnswerSource?: string;
  };
};

type YoryiSourceMeta = {
  metadata?: Record<string, unknown>;
};

type YoryiPayload = {
  answer?: string;
  answerSource?: string;
  responseType?: string;
  auditId?: string;
  actions?: Array<Record<string, unknown>>;
  provenance?: {
    sources?: YoryiSourceMeta[];
  };
  metadata?: Record<string, unknown>;
};

export function mapYoryiToCanonical(payload: unknown): CanonicalAssistantResponse | null {
  if (!isRecord(payload)) {
    return null;
  }

  const y = payload as YoryiPayload;
  const sourceMetadata = extractPayloadMetadata(y);
  const answer = asNonEmptyString(y.answer);
  const answerSource = asAllowedAnswerSource(y.answerSource);
  if (!answer || !answerSource) {
    return null;
  }

  return {
    answer,
    answerSource,
    responseType: mapResponseType(y.responseType),
    suggestedActions: mapActions(y.actions),
    metadata: {
      auditId: asNonEmptyString(y.auditId) ?? undefined,
      intentCode: extractMetaString(y.provenance?.sources, 'intentCode')
        ?? extractMetaString(y.provenance?.sources, 'resolvedIntentCode')
        ?? asNonEmptyString(sourceMetadata?.intentCode)
        ?? asNonEmptyString(sourceMetadata?.resolvedIntentCode)
        ?? undefined,
      traceId: extractMetaString(y.provenance?.sources, 'traceId')
        ?? asNonEmptyString(sourceMetadata?.traceId)
        ?? undefined,
      timestamp: asNonEmptyString(sourceMetadata?.timestamp) ?? undefined,
      tenantId: asNonEmptyString(sourceMetadata?.tenantId) ?? undefined,
      userId: asNonEmptyString(sourceMetadata?.userId) ?? undefined,
      role: asNonEmptyString(sourceMetadata?.role) ?? undefined,
      buildingId: asNonEmptyString(sourceMetadata?.buildingId) ?? undefined,
      unitId: asNonEmptyString(sourceMetadata?.unitId) ?? undefined,
      resolvedLevel: asResolvedLevel(sourceMetadata?.resolvedLevel) ?? undefined,
      resolvedIntentCode: asNonEmptyString(sourceMetadata?.resolvedIntentCode) ?? undefined,
      familyChosen: asIntentFamily(sourceMetadata?.familyChosen) ?? undefined,
      toolName: asNonEmptyString(sourceMetadata?.toolName) ?? undefined,
      fallbackPath: asNonEmptyString(sourceMetadata?.fallbackPath) ?? undefined,
      gatewayOutcome: asGatewayOutcome(sourceMetadata?.gatewayOutcome) ?? 'success',
      missingEntities: asStringArray(sourceMetadata?.missingEntities),
      defaultsApplied: asStringArray(sourceMetadata?.defaultsApplied),
      latencyMsTotal: asFiniteNumber(sourceMetadata?.latencyMsTotal),
      latencyMsRouting: asFiniteNumber(sourceMetadata?.latencyMsRouting),
      latencyMsGateway: asFiniteNumber(sourceMetadata?.latencyMsGateway),
      p0EnforcementEnabled: asBoolean(sourceMetadata?.p0EnforcementEnabled),
      p3Enabled: asBoolean(sourceMetadata?.p3Enabled),
      rawAnswerSource: typeof y.answerSource === 'string' ? y.answerSource : undefined,
    },
  };
}

function mapResponseType(value?: string): CanonicalAssistantResponse['responseType'] {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'list') return 'list';
  if (normalized === 'clarification') return 'clarification';
  if (normalized === 'metric') return 'exact';
  if (normalized === 'answer') return 'summary';
  if (normalized === 'summary') return 'summary';
  if (normalized === 'no_data') return 'clarification';
  return 'summary';
}

function mapActions(actions?: Array<Record<string, unknown>>): SuggestedAction[] {
  if (!Array.isArray(actions)) {
    return [];
  }

  const mapped: SuggestedAction[] = [];
  for (const action of actions) {
    if (!isRecord(action)) continue;
    const key = asNonEmptyString(action.key) ?? asNonEmptyString(action.type);
    if (!key) continue;
    const type = mapActionKeyToType(key);
    if (!type) continue;
    mapped.push({ type, payload: {} });
  }

  return mapped;
}

function mapActionKeyToType(actionKey: string): SuggestedActionType | null {
  const key = actionKey.trim().toLowerCase();
  if (['open-tickets', 'review-open-tickets', 'view-my-tickets'].includes(key)) return 'VIEW_TICKETS';
  if (['open-payments', 'review-pending-payments', 'view-all-payments', 'view-my-balance'].includes(key)) return 'VIEW_PAYMENTS';
  if (['open-charges', 'open-units', 'open-buildings', 'open-unit-details'].includes(key)) return 'VIEW_REPORTS';
  if (['open-documents', 'open-communications', 'view-notices', 'view-my-inbox'].includes(key)) return 'SEARCH_DOCS';
  if (key === 'create-communication') return 'DRAFT_COMMUNICATION';
  if (key === 'create-ticket') return 'CREATE_TICKET';
  return null;
}

function extractMetaString(
  sources: YoryiSourceMeta[] | undefined,
  key: string,
): string | null {
  if (!Array.isArray(sources)) return null;
  const value = sources[0]?.metadata?.[key];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function extractSourceMetadata(
  sources: YoryiSourceMeta[] | undefined,
): Record<string, unknown> | null {
  if (!Array.isArray(sources)) return null;
  const firstSource = sources[0];
  return isRecord(firstSource?.metadata) ? firstSource.metadata : null;
}

function extractPayloadMetadata(y: YoryiPayload): Record<string, unknown> | null {
  return extractSourceMetadata(y.provenance?.sources) ?? (isRecord(y.metadata) ? y.metadata : null);
}

function asResolvedLevel(
  value: unknown,
): CanonicalAssistantResponse['metadata']['resolvedLevel'] | null {
  if (value === 'P0' || value === 'P1' || value === 'P2B' || value === 'P2' || value === 'P3' || value === 'FALLBACK') {
    return value;
  }
  return null;
}

function asIntentFamily(value: unknown): IntentFamily | null {
  if (
    value === 'TOP_N' ||
    value === 'BREAKDOWN' ||
    value === 'TOTAL' ||
    value === 'TREND' ||
    value === 'AGING' ||
    value === 'OVERDUE' ||
    value === 'PAYMENT_STATUS' ||
    value === 'PAYMENT_HISTORY' ||
    value === 'LEGACY'
  ) {
    return value;
  }
  return null;
}

function asGatewayOutcome(value: unknown): GatewayOutcome | null {
  if (
    value === 'success' ||
    value === 'null' ||
    value === 'error' ||
    value === 'missing_entities' ||
    value === 'timeout' ||
    value === 'unavailable' ||
    value === 'invalid_payload' ||
    value === 'contract_mismatch' ||
    value === 'denied' ||
    value === 'invalid_entities' ||
    value === 'cache_hit' ||
    value === 'cache_miss' ||
    value === 'hitl_created'
  ) {
    return value;
  }
  return null;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return strings.length === value.length ? strings.map((entry) => entry.trim()) : undefined;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every(isRecord) ? value : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  return undefined;
}

function asAllowedAnswerSource(value?: string): CanonicalAssistantResponse['answerSource'] | null {
  if (value === 'live_data' || value === 'knowledge' || value === 'fallback' || value === 'snapshot') {
    return value;
  }
  return null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
