/**
 * Plan Limit Error Handler
 * Detects ConflictException (409) from plan limit enforcement
 * and displays user-friendly toast notifications
 */

import { HttpError } from '@/shared/lib/http/client';

export interface ToastFn {
  (message: string, type?: 'success' | 'error' | 'info', duration?: number): void;
}

export interface PlanLimitErrorMetadata {
  resource?: string; // e.g., "buildings", "units", "users"
  current?: number;
  limit?: number;
  code?: string;
}

/**
 * Detects if an error is a plan limit exceeded error (409 Conflict)
 * If yes, shows toast and returns true
 * If no, returns false (caller should handle as normal error)
 *
 * @param error The error object (any type)
 * @param toast Toast notification function
 * @returns true if error was handled as plan limit error, false otherwise
 *
 * @example
 * try {
 *   await createBuilding(data);
 * } catch (err) {
 *   if (!handlePlanLimitError(err, toast)) {
 *     toast('Unknown error', 'error');
 *   }
 * }
 */
export function handlePlanLimitError(
  error: unknown,
  toast: ToastFn
): boolean {
  // Check if it's an HttpError with 409 status
  if (!(error instanceof HttpError) || error.status !== 409) {
    return false;
  }

  // Parse error message - should contain "PLAN_LIMIT_EXCEEDED"
  const message = error.message || '';
  if (!message.includes('PLAN_LIMIT_EXCEEDED')) {
    return false;
  }

  // Extract metadata from error message if available
  // Backend sends: "PLAN_LIMIT_EXCEEDED: buildings (2/1)"
  let toastMessage = message;
  const match = message.match(/(\w+)\s*\((\d+)\/(\d+)\)/);
  if (match) {
    const [, resource, current, limit] = match;
    toastMessage = `Límite alcanzado: ${resource} (${current}/${limit}). Mejora tu plan.`;
  } else {
    toastMessage = 'Has alcanzado el límite de tu plan. Considera actualizar.';
  }

  // Show toast (duration: 6 seconds for this critical message)
  toast(toastMessage, 'error', 6000);
  return true;
}
