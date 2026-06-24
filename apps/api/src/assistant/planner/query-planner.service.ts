import { Injectable } from '@nestjs/common';
import { ExecutionPlan, ExtractedIntent, IntentFilters } from '../intent-engine/intent.types';
import { EntityResolution } from '../intent-engine/intent.types';
import type { CanonicalFinancePeriod } from '../finance-period.types';

/**
 * Supported query shapes for the allowlist
 */
type QueryShape =
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

/**
 * Intent to query shape mapping
 */
const INTENT_TO_SHAPE: Record<string, QueryShape> = {
  list_residents: 'unit_residents',
  get_residents: 'unit_residents',
  unit_residents: 'unit_residents',
  get_unit_residents: 'unit_residents',
  list_payments: 'unit_payments',
  get_balance: 'unit_debt',
  unit_debt: 'unit_debt',
  get_unit_debt: 'unit_debt',
  unit_documents: 'unit_documents',
  list_documents: 'unit_documents',
  unit_tickets: 'unit_tickets',
  search_tickets: 'unit_tickets',
  unit_payments: 'unit_payments',
  building_debt: 'building_debt',
  get_building_debt: 'building_debt',
  tenant_debt: 'tenant_debt',
  building_delinquents: 'building_delinquents',
  top_debtors: 'building_delinquents',
  building_documents: 'building_documents',
  list_building_documents: 'building_documents',
  building_tickets: 'building_tickets',
  building_payments: 'building_payments',
  building_stats: 'building_stats',
  get_building_stats: 'building_stats',
};

/**
 * Hardcoded allowlist of valid query shapes
 */
const ALLOWED_SHAPES = new Set<QueryShape>([
  'unit_residents',
  'unit_debt',
  'unit_documents',
  'unit_tickets',
  'unit_payments',
  'building_debt',
  'tenant_debt',
  'building_delinquents',
  'building_documents',
  'building_tickets',
  'building_payments',
  'building_stats',
]);

/**
 * Pagination defaults
 */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * QueryPlannerService - Builds ExecutionPlan from extracted intent and resolved entities
 *
 * Transforms an ExtractedIntent (from NLU) + EntityResolution (from resolver) into
 * a fully-parameterized ExecutionPlan ready for the QueryExecutorService.
 *
 * All filters are validated against a hardcoded allowlist to prevent arbitrary query construction.
 *
 * @example
 * ```typescript
 * const plan = planner.buildPlan(extractedIntent, resolvedEntities);
 * const result = await executor.execute(plan, tenantId, userRoles);
 * ```
 */
@Injectable()
export class QueryPlannerService {
  /**
   * Build an ExecutionPlan from extracted intent and resolved entities
   *
   * @param intent - Extracted intent from IntentExtractorService
   * @param resolved - Resolved entity references from EntityResolverService
   * @returns ExecutionPlan with validated filters and pagination
   * @throws Error if intent name is not in the allowlist
   */
  buildPlan(intent: ExtractedIntent, resolved: EntityResolution): ExecutionPlan {
    const queryShape = this.mapIntentToShape(intent.intent);

    const filters = this.applyFilters(intent.filters);
    const pagination = this.buildPagination(intent.filters);

    return {
      intent: queryShape,
      entityIds: this.buildEntityIds(resolved),
      filters,
      pagination,
    };
  }

  /**
   * Map intent name to a valid query shape
   */
  private mapIntentToShape(intentName: string): QueryShape {
    const shape = INTENT_TO_SHAPE[intentName];
    if (!shape) {
      throw new Error(`Query shape "${intentName}" is not in the allowlist`);
    }
    if (!ALLOWED_SHAPES.has(shape)) {
      throw new Error(`Query shape "${shape}" is not allowed`);
    }
    return shape;
  }

  /**
   * Build entity IDs from EntityResolution
   */
  private buildEntityIds(resolved: EntityResolution): ExecutionPlan['entityIds'] {
    return {
      buildingId: resolved.building?.id,
      unitId: resolved.unit?.id,
      personId: resolved.person?.id,
    };
  }

  /**
   * Apply and validate filters from the intent
   */
  private applyFilters(filters: IntentFilters): IntentFilters {
    const applied: IntentFilters = {};

    if (filters.minAmount !== undefined) {
      applied.minAmount = filters.minAmount;
    }

    if (filters.maxAmount !== undefined) {
      applied.maxAmount = filters.maxAmount;
    }

    if (filters.minDebt !== undefined) {
      applied.minDebt = filters.minDebt;
      // Backward-compatible mapping for executors still expecting minAmount
      if (applied.minAmount === undefined) {
        applied.minAmount = filters.minDebt;
      }
    }

    if (filters.period !== undefined) {
      const normalizedPeriod = this.normalizePeriod(filters.period);
      if (normalizedPeriod) {
        applied.period = normalizedPeriod;
      }
    }

    if (filters.status !== undefined) {
      applied.status = filters.status;
    }

    if (filters.method !== undefined) {
      applied.method = filters.method;
    }

    if (filters.minAgeDays !== undefined) {
      applied.minAgeDays = filters.minAgeDays;
    }

    if (filters.category !== undefined) {
      applied.category = filters.category;
    }

    if (filters.sortField !== undefined) {
      applied.sortField = filters.sortField;
    }

    if (filters.sortOrder !== undefined) {
      if (filters.sortOrder === 'asc' || filters.sortOrder === 'desc') {
        applied.sortOrder = filters.sortOrder;
      }
    }

    if (filters.limit !== undefined) {
      applied.limit = filters.limit;
    }

    return applied;
  }

  private normalizePeriod(period: string | CanonicalFinancePeriod): string | CanonicalFinancePeriod | undefined {
    if (typeof period === 'string') {
      return /^\d{4}-\d{2}$/.test(period) ? period : undefined;
    }

    if (period.kind === 'relative_range') {
      return period;
    }

    if (period.kind === 'current_month' && typeof period.year === 'number' && typeof period.month === 'number') {
      return `${period.year}-${String(period.month).padStart(2, '0')}`;
    }

    if (period.kind === 'previous_month' && typeof period.year === 'number' && typeof period.month === 'number') {
      return `${period.year}-${String(period.month).padStart(2, '0')}`;
    }

    if (period.kind === 'named_month' && typeof period.year === 'number' && typeof period.month === 'number') {
      return `${period.year}-${String(period.month).padStart(2, '0')}`;
    }

    if (period.kind === 'year_to_date' && typeof period.year === 'number') {
      return `${period.year}`;
    }

    return undefined;
  }

  /**
   * Build pagination with defaults and maximum limits
   */
  private buildPagination(filters: IntentFilters): ExecutionPlan['pagination'] {
    const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    return {
      limit,
      offset: filters.limit ? undefined : undefined,
    };
  }
}
