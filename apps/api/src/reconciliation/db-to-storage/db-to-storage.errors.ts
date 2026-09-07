import { ProviderErrorCategory } from './db-to-storage.types';

interface ErrorLike {
  readonly code?: unknown;
  readonly statusCode?: unknown;
  readonly message?: unknown;
}

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

function statusCode(error: unknown): number | undefined {
  const value = asErrorLike(error).statusCode;
  return typeof value === 'number' ? value : undefined;
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
