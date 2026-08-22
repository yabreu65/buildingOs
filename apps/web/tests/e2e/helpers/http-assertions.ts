import { expect, type APIRequestContext } from '@playwright/test';

/**
 * Expected HTTP failure status codes for RBAC / authorization tests.
 * These are legitimate 4xx responses that should NOT be treated as bugs.
 */
export const EXPECTED_FAILURE_STATUSES = {
  /** Forbidden — user lacks required role */
  FORBIDDEN: 403,
  /** Not Found — resource doesn't exist or is tenant-scoped out */
  NOT_FOUND: 404,
  /** Unauthorized — missing or invalid auth token */
  UNAUTHORIZED: 401,
} as const;

export type ExpectedFailureStatus =
  (typeof EXPECTED_FAILURE_STATUSES)[keyof typeof EXPECTED_FAILURE_STATUSES];

/**
 * Execute an API request and assert it returns an expected 4xx failure.
 *
 * This helper wraps the common RBAC assertion pattern:
 * "this endpoint MUST return 403/404 for this user role".
 *
 * Returns the response for further inspection if needed.
 *
 * @example
 * ```ts
 * // Resident cannot access tenant finance summary
 * const response = await expectHTTPFailure(page.request, {
 *   method: 'GET',
 *   url: `${API_ORIGIN}/tenants/${tenantId}/finance/summary`,
 *   headers: { 'X-Tenant-Id': tenantId },
 *   expectedStatus: EXPECTED_FAILURE_STATUSES.FORBIDDEN,
 * });
 * expect(response.status()).toBe(403);
 * ```
 */
export async function expectHTTPFailure(
  request: APIRequestContext,
  options: {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    url: string;
    headers?: Record<string, string>;
    data?: unknown;
    expectedStatus: ExpectedFailureStatus;
  },
) {
  const response = await request.fetch(options.url, {
    method: options.method,
    headers: {
      Accept: 'application/json',
      ...options.headers,
    },
    data: options.data,
  });

  const status = response.status();
  // Assert it's a 4xx (client error)
  expect(status).toBeGreaterThanOrEqual(400);
  expect(status).toBeLessThan(500);
  expect(status).toBe(options.expectedStatus);

  return response;
}

/**
 * Assert that a response is a successful 2xx response.
 * Counterpart to `expectHTTPFailure` for positive RBAC tests.
 */
export async function expectHTTPSuccess(
  request: APIRequestContext,
  options: {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    url: string;
    headers?: Record<string, string>;
    data?: unknown;
  },
) {
  const response = await request.fetch(options.url, {
    method: options.method,
    headers: {
      Accept: 'application/json',
      ...options.headers,
    },
    data: options.data,
  });

  expect(response.ok()).toBe(true);
  return response;
}
