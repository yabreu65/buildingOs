/**
 * Validation and normalization helpers for storage operations.
 * Provides safe parsing, normalization, and type validation.
 */

/**
 * Safely parse array from raw value (handles corrupt/missing data gracefully).
 * Returns empty array on parse error instead of crashing.
 * @param raw - Raw value (string, array, or unknown)
 * @returns Validated array or empty array
 */
export function safeParseArray<T>(raw: unknown): T[] {
  // Handle null or undefined
  if (raw === null || raw === undefined) {
    return [];
  }

  // Handle string (JSON)
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  // Handle array
  if (Array.isArray(raw)) {
    return raw;
  }

  // Handle other types (object, number, etc.)
  return [];
}

/**
 * Safely parse object from raw value (handles corrupt/missing data gracefully).
 * Returns default value on parse error instead of crashing.
 * @param raw - Raw value (string, object, or unknown)
 * @param defaultValue - Default object to return on error
 * @returns Validated object or defaultValue
 */
export function safeParseObject<T>(raw: unknown, defaultValue: T): T {
  // Handle null or undefined
  if (raw === null || raw === undefined) {
    return defaultValue;
  }

  // Handle string (JSON)
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  }

  // Handle object
  if (typeof raw === 'object') {
    return raw as T;
  }

  // Handle other types
  return defaultValue;
}

/**
 * Normalize string for case-insensitive uniqueness checks.
 * Trims whitespace and converts to lowercase.
 * @param str - String to normalize (optional)
 * @returns Normalized string or empty string
 */
export function normalize(str?: string): string {
  return (str || '').trim().toLowerCase();
}

/**
 * Validate that a string is non-empty after normalization.
 * @param str - String to validate
 * @returns true if non-empty after normalization
 */
export function isValidString(str?: string): boolean {
  return normalize(str).length > 0;
}

/**
 * Validate that a value is a non-empty array.
 * @param arr - Array to validate
 * @returns true if array has elements
 */
export function isValidArray<T>(arr: unknown): arr is T[] {
  return Array.isArray(arr) && arr.length > 0;
}

/**
 * Validate that an object has expected properties.
 * Used for basic structural validation.
 * @param obj - Object to validate
 * @param requiredKeys - Keys that must exist
 * @returns true if object has all required keys
 */
export function hasRequiredKeys(obj: unknown, requiredKeys: string[]): boolean {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const objRecord = obj as Record<string, unknown>;
  return requiredKeys.every((key) => key in objRecord);
}

/**
 * Validate that a string is a valid email address (basic check).
 * @param email - Email to validate
 * @returns true if email looks valid
 */
export function isValidEmail(email?: string): boolean {
  if (!email) return false;
  const normalized = normalize(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

/**
 * Validate that a string is a valid UUID (v4 format).
 * @param uuid - UUID to validate
 * @returns true if UUID format is valid
 */
export function isValidUUID(uuid?: string): boolean {
  if (!uuid) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Validate that a value is within a given range.
 * @param value - Number to validate
 * @param min - Minimum inclusive value
 * @param max - Maximum inclusive value
 * @returns true if value is in range
 */
export function isInRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}
