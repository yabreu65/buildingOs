import type { Permission } from '../rbac/permissions';

export type AssistantQueryModule = 'units' | 'payments' | 'tickets' | 'documents' | 'buildings';

export type AssistantQueryIntent =
  | 'unit_residents'
  | 'unit_debt'
  | 'unit_tickets'
  | 'building_tickets'
  | 'building_stats';

export type AssistantQueryScope = 'unit' | 'building';

export interface AssistantQueryPlanFilters {
  buildingToken?: string;
  unitCode?: string;
  buildingAlias?: string;
  buildingName?: string;
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
