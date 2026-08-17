/**
 * FIN-07A: factory de query keys para React Query (módulo finance).
 *
 * Convención: [scope, tenantId, ...entityId/filters].
 * Todas las keys son tenant-scoped (nunca cross-tenant).
 */

export const financeKeys = {
  funds: (tenantId: string, query?: { buildingId?: string; scopeType?: string; status?: string }) =>
    ['finance', tenantId, 'funds', query ?? {}] as const,
  fund: (tenantId: string, fundId: string) =>
    ['finance', tenantId, 'funds', fundId] as const,
  fundTransactions: (
    tenantId: string,
    fundId: string,
    query?: { currencyCode?: string; limit?: number; offset?: number },
  ) => ['finance', tenantId, 'funds', fundId, 'transactions', query ?? {}] as const,

  incomes: (tenantId: string, query?: { buildingId?: string; period?: string; categoryId?: string }) =>
    ['finance', tenantId, 'incomes', query ?? {}] as const,
  income: (tenantId: string, incomeId: string) =>
    ['finance', tenantId, 'incomes', incomeId] as const,
  incomeApplications: (tenantId: string, incomeId: string) =>
    ['finance', tenantId, 'incomes', incomeId, 'applications'] as const,

  incomePolicies: (tenantId: string) => ['finance', tenantId, 'income-policies'] as const,
  incomePolicy: (tenantId: string, categoryId: string) =>
    ['finance', tenantId, 'income-policies', categoryId] as const,

  legacyBackfillPreview: (
    tenantId: string,
    query?: { period?: string; categoryId?: string; destination?: string },
  ) =>
    ['finance', tenantId, 'legacy-backfill', 'preview', query ?? {}] as const,
  financeSettings: (tenantId: string) => ['finance', tenantId, 'settings'] as const,

  liquidations: (tenantId: string, query?: { buildingId?: string; period?: string }) =>
    ['finance', tenantId, 'liquidations', query ?? {}] as const,
  liquidation: (tenantId: string, liquidationId: string) =>
    ['finance', tenantId, 'liquidations', liquidationId] as const,
};

/**
 * Familias de keys usadas para invalidación (exactas, sin prefix mágicos).
 */
export const financeKeyFamilies = {
  funds: (tenantId: string) => ['finance', tenantId, 'funds'] as const,
  incomes: (tenantId: string) => ['finance', tenantId, 'incomes'] as const,
  incomePolicies: (tenantId: string) => ['finance', tenantId, 'income-policies'] as const,
  legacyBackfill: (tenantId: string) => ['finance', tenantId, 'legacy-backfill'] as const,
  liquidations: (tenantId: string) => ['finance', tenantId, 'liquidations'] as const,
};
