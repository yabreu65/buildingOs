export type AssistantReadOnlyIntentCode =
  | 'GET_OVERDUE_UNITS'
  | 'GET_PENDING_PAYMENTS'
  | 'GET_OPEN_TICKETS'
  | 'GET_VACANT_UNITS'
  | 'GET_COLLECTIONS_SUMMARY';

export type AssistantReadOnlyLegacyIntent =
  | 'admin_arrears_by_building'
  | 'admin_pending_payments_month'
  | 'admin_open_tickets_by_building'
  | 'admin_vacant_units'
  | 'admin_collections_summary_month';

export type AssistantReadOnlyResponseType =
  | 'metric'
  | 'list'
  | 'summary'
  | 'no_data'
  | 'clarification';

export type AssistantReadOnlyAction = {
  key: string;
  label: string;
  description?: string;
  requiresConfirmation?: boolean;
  destructive?: boolean;
  requiredPermission?: string;
};

export interface AssistantReadOnlyQueryContext {
  appId?: string;
  tenantId: string;
  userId: string;
  role: string;
  route?: string;
  currentModule?: string;
  permissions?: string[];
}

export interface AssistantReadOnlyQueryRequest {
  intentCode?: string;
  intent?: string;
  question: string;
  context: AssistantReadOnlyQueryContext;
}

export interface AssistantReadOnlyQueryResponse {
  answer: string;
  answerSource: 'live_data';
  responseType: AssistantReadOnlyResponseType;
  dataScope: 'tenant';
  actions: AssistantReadOnlyAction[];
  metadata: Record<string, unknown>;
}

export type AssistantReadOnlyIntentDefinition = {
  code: AssistantReadOnlyIntentCode;
  resolverKey:
    | 'overdueUnitsResolver'
    | 'pendingPaymentsResolver'
    | 'openTicketsResolver'
    | 'vacantUnitsResolver'
    | 'collectionsSummaryResolver';
  rolesAllowed: string[];
  responseType: 'list' | 'summary';
  answerSource: 'live_data';
  legacyAliases: AssistantReadOnlyLegacyIntent[];
};

export const ASSISTANT_READ_ONLY_INTENTS: Record<
  AssistantReadOnlyIntentCode,
  AssistantReadOnlyIntentDefinition
> = {
  GET_OVERDUE_UNITS: {
    code: 'GET_OVERDUE_UNITS',
    resolverKey: 'overdueUnitsResolver',
    rolesAllowed: ['SUPER_ADMIN', 'TENANT_OWNER', 'TENANT_ADMIN'],
    responseType: 'list',
    answerSource: 'live_data',
    legacyAliases: ['admin_arrears_by_building'],
  },
  GET_PENDING_PAYMENTS: {
    code: 'GET_PENDING_PAYMENTS',
    resolverKey: 'pendingPaymentsResolver',
    rolesAllowed: ['SUPER_ADMIN', 'TENANT_OWNER', 'TENANT_ADMIN'],
    responseType: 'list',
    answerSource: 'live_data',
    legacyAliases: ['admin_pending_payments_month'],
  },
  GET_OPEN_TICKETS: {
    code: 'GET_OPEN_TICKETS',
    resolverKey: 'openTicketsResolver',
    rolesAllowed: ['SUPER_ADMIN', 'TENANT_OWNER', 'TENANT_ADMIN'],
    responseType: 'list',
    answerSource: 'live_data',
    legacyAliases: ['admin_open_tickets_by_building'],
  },
  GET_VACANT_UNITS: {
    code: 'GET_VACANT_UNITS',
    resolverKey: 'vacantUnitsResolver',
    rolesAllowed: ['SUPER_ADMIN', 'TENANT_OWNER', 'TENANT_ADMIN'],
    responseType: 'list',
    answerSource: 'live_data',
    legacyAliases: ['admin_vacant_units'],
  },
  GET_COLLECTIONS_SUMMARY: {
    code: 'GET_COLLECTIONS_SUMMARY',
    resolverKey: 'collectionsSummaryResolver',
    rolesAllowed: ['SUPER_ADMIN', 'TENANT_OWNER', 'TENANT_ADMIN'],
    responseType: 'summary',
    answerSource: 'live_data',
    legacyAliases: ['admin_collections_summary_month'],
  },
};

const ALIAS_MAP: Record<AssistantReadOnlyLegacyIntent, AssistantReadOnlyIntentCode> = {
  admin_arrears_by_building: 'GET_OVERDUE_UNITS',
  admin_pending_payments_month: 'GET_PENDING_PAYMENTS',
  admin_open_tickets_by_building: 'GET_OPEN_TICKETS',
  admin_vacant_units: 'GET_VACANT_UNITS',
  admin_collections_summary_month: 'GET_COLLECTIONS_SUMMARY',
};

export function resolveReadOnlyIntentCode(
  code?: string,
  legacy?: string,
): AssistantReadOnlyIntentCode | null {
  const normalizedCode = (code ?? '').trim().toUpperCase();
  if (normalizedCode && normalizedCode in ASSISTANT_READ_ONLY_INTENTS) {
    return normalizedCode as AssistantReadOnlyIntentCode;
  }

  const normalizedLegacy = (legacy ?? '').trim().toLowerCase();
  if (!normalizedLegacy) {
    return null;
  }

  if (normalizedLegacy in ALIAS_MAP) {
    return ALIAS_MAP[normalizedLegacy as AssistantReadOnlyLegacyIntent];
  }

  return null;
}
