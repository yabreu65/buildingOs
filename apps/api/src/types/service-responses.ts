/**
 * Service Response Helper Types
 * Used across all service methods for explicit return types
 */

/**
 * Standard paginated list response
 */
export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Generic service response wrapper
 */
export interface ServiceResponse<T> {
  data: T;
  timestamp: Date;
}

/**
 * Batch operation result
 */
export interface BatchOperationResult {
  success: number;
  failed: number;
  errors: Array<{
    id: string;
    error: string;
  }>;
}

/**
 * Count result for delete/update operations
 */
export interface CountResult {
  count: number;
}
