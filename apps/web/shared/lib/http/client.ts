import { getCurrentImpersonationToken, clearAllImpersonationData } from '../../../features/impersonation/impersonation.storage';
import { clearAuth } from '../../../features/auth/session.storage';
import { getPublicApiUrl } from '../public-api-url';

export interface HttpRequestConfig<TReq = never> {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: TReq;
  headers?: Record<string, string>;
}

export interface ErrorResponseData {
  code?: string;
  message?: string | string[];
  error?: string;
  statusCode?: number;
}

export class HttpError extends Error {
  public data: ErrorResponseData | null;

  constructor(
    public status: number,
    public statusText: string,
    message: string,
    data?: ErrorResponseData | null,
  ) {
    super(message);
    this.name = 'HttpError';
    this.data = data ?? null;
  }
}

const API_URL = getPublicApiUrl();

/**
 * 204 responses intentionally have no response body.
 * Callers should treat the return value as void-compatible.
 */
function noContentResponse<TRes>(): TRes {
  return undefined as TRes;
}

async function parseErrorResponse(response: Response): Promise<{
  message: string;
  data: ErrorResponseData | null;
}> {
  try {
    const json: Record<string, unknown> = await response.json();
    if (typeof json === 'object' && json !== null) {
      const msg = json.message;
      const message =
        typeof msg === 'string'
          ? msg
          : Array.isArray(msg)
            ? msg.join(', ')
            : response.statusText || 'Error desconocido';
      return { message, data: json as ErrorResponseData };
    }
  } catch {
    // ignore parse error
  }
  return { message: response.statusText || 'Error desconocido', data: null };
}

async function tryRefreshAuthCookie(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function apiClient<TRes, TReq = never>(
  config: HttpRequestConfig<TReq>,
): Promise<TRes> {
  const { path, method = 'GET', body, headers: customHeaders } = config;

  const url = `${API_URL}${path}`;
  const token = getCurrentImpersonationToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const init: RequestInit = {
    method,
    headers,
    credentials: 'include',
  };

  if (body && method !== 'GET') {
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);

  if (!response.ok) {
    // Centralized 401 handler: try refresh cookie once, then fall back to login.
    if (response.status === 401) {
      const hasImpersonationToken = !!getCurrentImpersonationToken();
      const isAuthRoute =
        path === '/auth/refresh' ||
        path === '/auth/login' ||
        path === '/auth/signup';

      if (!hasImpersonationToken && !isAuthRoute) {
        const refreshed = await tryRefreshAuthCookie();
        if (refreshed) {
          const retryResponse = await fetch(url, init);
          if (retryResponse.ok) {
            if (retryResponse.status === 204) {
              return noContentResponse<TRes>();
            }
            return retryResponse.json() as Promise<TRes>;
          }

          if (retryResponse.status !== 401) {
            const retryError = await parseErrorResponse(retryResponse);
            throw new HttpError(
              retryResponse.status,
              retryResponse.statusText,
              retryError.message,
              retryError.data,
            );
          }
        }
      }

      clearAllImpersonationData();
      clearAuth();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
      throw new HttpError(401, 'Unauthorized', 'Sesión expirada. Redirigiendo a login...');
    }

    const { message, data } = await parseErrorResponse(response);
    throw new HttpError(response.status, response.statusText, message, data);
  }

  if (response.status === 204) {
    return noContentResponse<TRes>();
  }

  return response.json() as Promise<TRes>;
}
