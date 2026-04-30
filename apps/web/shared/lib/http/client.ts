import { getToken, clearToken } from '../../../features/auth/session.storage';

export interface HttpRequestConfig<TReq = never> {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: TReq;
  headers?: Record<string, string>;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function sanitizeForJson(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeForJson);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return { message: value.message, name: value.name };
  }
  if (typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (key === '__proto__' || key === 'constructor') continue;
      sanitized[key] = sanitizeForJson(val);
    }
    return sanitized;
  }
  return value;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const json = await response.json();
    if (typeof json === 'object' && json !== null && 'message' in json) {
      const message = json.message;
      if (typeof message === 'string') {
        return message;
      }
      if (Array.isArray(message)) {
        return message.join(', ');
      }
    }
  } catch {
    // ignore parse error
  }
  return response.statusText || 'Error desconocido';
}

export async function apiClient<TRes, TReq = never>(
  config: HttpRequestConfig<TReq>,
): Promise<TRes> {
  const { path, method = 'GET', body, headers: customHeaders } = config;

  const url = `${API_URL}${path}`;
  const token = getToken();

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
    const safeBody = sanitizeForJson(body);
    init.body = JSON.stringify(safeBody);
  }

  const response = await fetch(url, init);

  if (!response.ok) {
    // Centralized 401 handler: clear token and redirect to login
    if (response.status === 401) {
      clearToken();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
      throw new HttpError(401, 'Unauthorized', 'Sesión expirada. Redirigiendo a login...');
    }

    const message = await parseErrorMessage(response);
    throw new HttpError(response.status, response.statusText, message);
  }

  if (response.status === 204) {
    return undefined as unknown as TRes;
  }

  return response.json() as Promise<TRes>;
}
