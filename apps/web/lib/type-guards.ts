/**
 * Type guards and predicates for runtime type narrowing
 * Use these to safely narrow types at runtime
 */
import {
  StoredAuthSession,
  StoredUnit,
  StoredBuilding,
  InvitationData,
  StoredTenant,
} from './storage-schemas';
import {
  ChargeStatus,
  TicketStatus,
  TicketPriority,
  CommunicationChannel,
  CommunicationType,
  WorkOrderStatus,
  QuoteStatus,
  UserRole,
} from '@/types/enums';

// ============================================================================
// Storage Type Guards
// ============================================================================

export function isStoredAuthSession(value: unknown): value is StoredAuthSession {
  return (
    typeof value === 'object' &&
    value !== null &&
    'token' in value &&
    'user' in value &&
    'memberships' in value &&
    typeof (value as Record<string, unknown>).token === 'string' &&
    Array.isArray((value as Record<string, unknown>).memberships)
  );
}

export function isStoredUnit(value: unknown): value is StoredUnit {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'label' in value &&
    'buildingId' in value &&
    typeof (value as Record<string, unknown>).id === 'string' &&
    typeof (value as Record<string, unknown>).label === 'string'
  );
}

export function isStoredBuilding(value: unknown): value is StoredBuilding {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'tenantId' in value &&
    'name' in value &&
    typeof (value as Record<string, unknown>).id === 'string' &&
    typeof (value as Record<string, unknown>).name === 'string'
  );
}

export function isInvitationData(value: unknown): value is InvitationData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'token' in value &&
    'tenantId' in value &&
    'email' in value &&
    'expiresAt' in value &&
    typeof (value as Record<string, unknown>).token === 'string' &&
    typeof (value as Record<string, unknown>).expiresAt === 'number'
  );
}

export function isStoredTenant(value: unknown): value is StoredTenant {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    typeof (value as Record<string, unknown>).id === 'string' &&
    typeof (value as Record<string, unknown>).name === 'string'
  );
}

// ============================================================================
// Enum Guards (Charge, Ticket, etc.)
// ============================================================================

export function isChargeStatus(value: unknown): value is ChargeStatus {
  return value === 'PENDING' || value === 'PAID' || value === 'PARTIAL' || value === 'CANCELED';
}

export function isTicketStatus(value: unknown): value is TicketStatus {
  return (
    value === 'OPEN' ||
    value === 'IN_PROGRESS' ||
    value === 'RESOLVED' ||
    value === 'CLOSED'
  );
}

export function isTicketPriority(value: unknown): value is TicketPriority {
  return (
    value === 'LOW' || value === 'MEDIUM' || value === 'HIGH' || value === 'URGENT'
  );
}

export function isCommunicationChannel(
  value: unknown
): value is CommunicationChannel {
  return value === 'EMAIL' || value === 'SMS' || value === 'PUSH' || value === 'IN_APP';
}

export function isCommunicationType(
  value: unknown
): value is CommunicationType {
  return (
    value === 'ANNOUNCEMENT' ||
    value === 'NOTIFICATION' ||
    value === 'ALERT'
  );
}

export function isWorkOrderStatus(value: unknown): value is WorkOrderStatus {
  return (
    value === 'OPEN' ||
    value === 'IN_PROGRESS' ||
    value === 'DONE' ||
    value === 'CANCELLED'
  );
}

export function isQuoteStatus(value: unknown): value is QuoteStatus {
  return (
    value === 'REQUESTED' ||
    value === 'RECEIVED' ||
    value === 'APPROVED' ||
    value === 'REJECTED'
  );
}

export function isUserRole(value: unknown): value is UserRole {
  return (
    value === 'SUPER_ADMIN' ||
    value === 'TENANT_OWNER' ||
    value === 'TENANT_ADMIN' ||
    value === 'OPERATOR' ||
    value === 'RESIDENT'
  );
}

// ============================================================================
// Error Guards
// ============================================================================

export function isErrorWithMessage(
  error: unknown
): error is { message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as Record<string, unknown>).message === 'string'
  );
}

export function isApiErrorResponse(
  error: unknown
): error is {
  statusCode: number;
  message: string;
  error?: string;
} {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    'message' in error &&
    typeof (error as Record<string, unknown>).statusCode === 'number' &&
    typeof (error as Record<string, unknown>).message === 'string'
  );
}

/**
 * Extract error message from unknown error type
 * Safe fallback for error handlers
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (isErrorWithMessage(error)) {
    return error.message;
  }
  if (isApiErrorResponse(error)) {
    return error.message;
  }
  return String(error);
}

/**
 * Extract HTTP status code from error
 * Returns 500 if not found
 */
export function getErrorStatus(error: unknown): number {
  if (isApiErrorResponse(error)) {
    return error.statusCode;
  }
  return 500;
}

// ============================================================================
// Array Guards
// ============================================================================

/**
 * Type guard to check if a value is an array of a specific type
 * @template T The type to guard for
 * @param value The value to check
 * @param guard Type predicate function for individual items
 * @returns True if value is an array where all items match the guard
 */
export function isArrayOf<T>(
  value: unknown,
  guard: (item: unknown) => item is T
): value is T[] {
  return Array.isArray(value) && value.every(guard);
}

/**
 * Type guard to check if a value is a non-empty array of a specific type
 * @template T The type to guard for
 * @param value The value to check
 * @param guard Type predicate function for individual items
 * @returns True if value is a non-empty array where all items match the guard
 */
export function isNonEmptyArray<T>(
  value: unknown,
  guard: (item: unknown) => item is T
): value is [T, ...T[]] {
  return isArrayOf(value, guard) && value.length > 0;
}

// ============================================================================
// Utility Guards
// ============================================================================

/**
 * Type guard to check if a value is defined (not undefined)
 * Useful for filtering out undefined values in arrays
 * @template T The type to guard for
 * @param value The value to check
 * @returns True if value is not undefined
 */
export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/**
 * Type guard to check if a value is not null
 * @template T The type to guard for
 * @param value The value to check
 * @returns True if value is not null
 */
export function isNotNull<T>(value: T | null): value is T {
  return value !== null;
}

/**
 * Type guard to check if a value is neither null nor undefined
 * Combines isDefined and isNotNull checks
 * @template T The type to guard for
 * @param value The value to check
 * @returns True if value is not null and not undefined
 */
export function isNotNullOrUndefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Type guard to check if a value is a string
 * @param value The value to check
 * @returns True if value is a string
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Type guard to check if a value is a valid number
 * Excludes NaN which is technically a number type
 * @param value The value to check
 * @returns True if value is a number and not NaN
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

/**
 * Type guard to check if a value is a boolean
 * @param value The value to check
 * @returns True if value is a boolean
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/**
 * Type guard to check if a value is a plain object (record)
 * Excludes arrays and null
 * @param value The value to check
 * @returns True if value is a plain object
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
