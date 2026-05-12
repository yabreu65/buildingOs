import { Permission } from '../../rbac/permissions';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Supported response types for intent execution
 */
export type SupportedResponseType = 'text' | 'table' | 'kpi' | 'chart' | 'clarification';

/**
 * Supported filter types for intent execution
 */
export type SupportedFilter =
  | 'minAmount'
  | 'maxAmount'
  | 'period'
  | 'status'
  | 'method'
  | 'minAgeDays'
  | 'category'
  | 'sortField'
  | 'sortOrder'
  | 'limit';

/**
 * Intent filters that can be applied during execution
 */
export interface IntentFilters {
  minAmount?: number;
  maxAmount?: number;
  period?: string;
  status?: string;
  method?: string;
  minAgeDays?: number;
  category?: string;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
}

/**
 * Pagination options for intent execution
 */
export interface IntentPagination {
  limit: number;
  offset?: number;
}

/**
 * Entity reference extracted from user input
 */
export interface EntityReference {
  type: 'unit' | 'building' | 'person';
  buildingAlias?: string;
  unitCode?: string;
  personName?: string;
}

/**
 * Defines an intent that the NLU engine can handle
 */
export interface IntentDefinition {
  /** Unique intent name (e.g., 'list_payments', 'search_tickets') */
  name: string;
  /** Permission required to execute this intent */
  requiredPermission: Permission;
  /** Filters this intent supports */
  supportedFilters: SupportedFilter[];
  /** Response types this intent can produce */
  supportedResponseTypes: SupportedResponseType[];
  /**
   * Executor function for this intent
   * Returns structured data to be formatted by the response formatter
   */
  executor: IntentExecutor;
}

/**
 * Executor function signature for intent execution
 */
export type IntentExecutor = (params: {
  tenantId: string;
  entityIds?: {
    buildingId?: string;
    unitId?: string;
    personId?: string;
  };
  filters: IntentFilters;
  pagination: IntentPagination;
  prisma: PrismaService;
}) => Promise<IntentExecutionResult>;

/**
 * Result from intent executor
 */
export interface IntentExecutionResult {
  data: unknown;
  meta?: Record<string, unknown>;
}

/**
 * Execution plan created by the planner
 */
export interface ExecutionPlan {
  intent: string;
  entityIds?: {
    buildingId?: string;
    unitId?: string;
    personId?: string;
  };
  filters: IntentFilters;
  pagination: IntentPagination;
}

/**
 * Intent extracted from user input with confidence score
 */
export interface ExtractedIntent {
  /** Intent name */
  intent: string;
  /** Resolved entity reference */
  entity: EntityReference;
  /** Applied filters */
  filters: IntentFilters;
  /** Confidence score 0-1 */
  confidence: number;
}

/**
 * Structured response types
 */
export type ResponseType = 'text' | 'table' | 'kpi' | 'chart' | 'clarification';

/**
 * Action that can be suggested in a response
 */
export interface SuggestedAction {
  type: string;
  label: string;
  payload: Record<string, string>;
}

/**
 * Structured response from the NLU engine
 */
export interface StructuredResponse {
  /** Response type */
  type: ResponseType;
  /** Response title */
  title: string;
  /** Human-readable summary */
  summary: string;
  /** Response data (format depends on type) */
  data?: unknown;
  /** Suggested actions */
  actions?: SuggestedAction[];
  /** Additional metadata */
  meta?: Record<string, unknown>;
}

/**
 * Registry entry with metadata
 */
export interface IntentRegistryEntry {
  /** Intent definition */
  definition: IntentDefinition;
  /** Registration timestamp */
  registeredAt: Date;
  /** Whether intent is enabled */
  enabled: boolean;
}

/**
 * Resolved entity with alternatives for disambiguation
 */
export interface EntityResolution {
  /** Resolved building reference */
  building?: {
    id: string;
    name: string;
    alias?: string;
  };
  /** Resolved unit reference */
  unit?: {
    id: string;
    code: string;
    label?: string;
    buildingId: string;
  };
  /** Resolved person reference */
  person?: {
    id: string;
    name: string;
    unitId?: string;
  };
  /** Alternative resolutions for disambiguation */
  alternatives: EntityAlternative[];
}

/**
 * Alternative entity resolution
 */
export interface EntityAlternative {
  type: 'building' | 'unit' | 'person';
  id: string;
  displayName: string;
  matchScore: number;
  reason: string;
}

/**
 * Ambiguity detection result
 */
export interface AmbiguityResult {
  /** Whether the input is ambiguous */
  isAmbiguous: boolean;
  /** Alternative interpretations */
  alternatives: AmbiguityAlternative[];
  /** Message to ask for clarification */
  clarificationMessage?: string;
}

/**
 * Alternative interpretation for ambiguity
 */
export interface AmbiguityAlternative {
  intent: string;
  entity: EntityReference;
  confidence: number;
  reason: string;
}

/**
 * A single turn in a conversation
 */
export interface ConversationTurn {
  /** Role in conversation */
  role: 'user' | 'assistant' | 'system';
  /** Message content */
  message: string;
  /** Timestamp */
  timestamp: Date;
  /** Resolved entities from this turn */
  resolvedEntities?: EntityResolution;
}

/**
 * Conversation context for intent extraction
 */
export interface ConversationContext {
  /** Current building ID if known */
  buildingId?: string;
  /** Current unit ID if known */
  unitId?: string;
  /** Current user ID */
  userId?: string;
  /** Previous conversation turns */
  previousTurns?: ConversationTurn[];
}