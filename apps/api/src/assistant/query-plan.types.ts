import type { Permission } from '../rbac/permissions';
import type { CanonicalFinancePeriod } from './finance-period.types';

export type AssistantQueryModule = 'units' | 'payments' | 'tickets' | 'documents' | 'buildings';

export type AssistantQueryIntent =
  | 'unit_residents'
  | 'unit_debt'
  | 'unit_documents'
  | 'unit_tickets'
  | 'unit_payments'
  | 'building_debt'
  | 'tenant_debt'
  | 'building_delinquents'
  | 'building_documents'
  | 'building_tickets'
  | 'building_payments'
  | 'building_stats';

export type AssistantQueryScope = 'unit' | 'building' | 'tenant';

export interface AssistantQueryPlanFilters {
  buildingToken?: string;
  unitCode?: string;
  unitCodeRaw?: string;
  buildingAlias?: string;
  buildingName?: string;
  personName?: string;
  period?: string | CanonicalFinancePeriod;
  status?: string;
  method?: string;
  minAmount?: number;
  maxAmount?: number;
  minDebt?: number;
  minAgeDays?: number;
}

export interface AssistantQueryPlan {
  intent: AssistantQueryIntent;
  module: AssistantQueryModule;
  scope: AssistantQueryScope;
  requiredPermission: Permission;
  executor: AssistantQueryIntent;
  filters: AssistantQueryPlanFilters;
  confidence: number;
  source: 'deterministic_rules';
}

export interface AssistantQueryExecutionContext {
  tenantId: string;
  userId: string;
  userRoles: string[];
  plan: AssistantQueryPlan;
}
