import { getToken, clearToken } from '../../../features/auth/session.storage';

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

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

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
    init.body = JSON.stringify(body);
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

    const { message, data } = await parseErrorResponse(response);
    throw new HttpError(response.status, response.statusText, message, data);
  }

  if (response.status === 204) {
    return undefined as unknown as TRes;
  }

  return response.json() as Promise<TRes>;
}
