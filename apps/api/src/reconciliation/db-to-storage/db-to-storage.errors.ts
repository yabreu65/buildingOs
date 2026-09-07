import { ProviderErrorCategory } from './db-to-storage.types';

interface ErrorLike {
  readonly code?: unknown;
  readonly statusCode?: unknown;
  readonly message?: unknown;
}

const CONCLUSIVE_NOT_FOUND_CODES = new Set(['NotFound', 'NoSuchKey', 'NoSuchVersion']);
const OPERATIONAL_ERROR_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN']);

function asErrorLike(error: unknown): ErrorLike {
  return typeof error === 'object' && error !== null ? error as ErrorLike : {};
}

function errorText(error: unknown): string {
  const value = asErrorLike(error).message;
  return typeof value === 'string' ? value.toLowerCase() : String(error).toLowerCase();
}

function errorCode(error: unknown): string {
  const value = asErrorLike(error).code;
  return typeof value === 'string' ? value.toUpperCase() : '';
}

function rawErrorCode(error: unknown): string {
  const value = asErrorLike(error).code;
  return typeof value === 'string' ? value : '';
}

function statusCode(error: unknown): number | undefined {
  const value = asErrorLike(error).statusCode;
  return typeof value === 'number' ? value : undefined;
}

/**
 * Applies the reconciliation scanner's stricter absence policy.
 * Operational evidence always wins over provider not-found labels.
 */
export function isConclusiveNotFoundError(error: unknown): boolean {
  const status = statusCode(error);
  const code = rawErrorCode(error);
  const text = errorText(error);

  if ((status !== undefined && status !== 404) || OPERATIONAL_ERROR_CODES.has(code.toUpperCase())) {
    return false;
  }

  const category = classifyProviderError(error);
  if (
    category !== 'PROVIDER_ERROR' ||
    text.includes('connection reset') ||
    text.includes('network') ||
    text.includes('socket')
  ) {
    return false;
  }

  return CONCLUSIVE_NOT_FOUND_CODES.has(code);
}

export function classifyProviderError(error: unknown): ProviderErrorCategory {
  const code = errorCode(error);
  const text = errorText(error);
  const status = statusCode(error);

  if (status === 401 || status === 403 || code === 'ACCESSDENIED' || code === 'INVALIDACCESSKEYID') {
    return 'AUTHORIZATION';
  }

  if (
    code === 'ETIMEDOUT'
    || code === 'ESOCKETTIMEDOUT'
    || text.includes('timeout')
    || text.includes('timed out')
  ) {
    return 'TIMEOUT';
  }

  if (
    code === 'ECONNREFUSED'
    || code === 'ECONNRESET'
    || code === 'ENOTFOUND'
    || code === 'EAI_AGAIN'
    || text.includes('connection refused')
    || text.includes('dns')
    || text.includes('tls')
  ) {
    return 'NETWORK';
  }

  if (status !== undefined && status >= 500) {
    return 'SERVER_ERROR';
  }

  return 'PROVIDER_ERROR';
}
