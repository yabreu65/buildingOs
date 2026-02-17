import { getToken } from '../../../features/auth/session.storage';

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
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);

  if (!response.ok) {
    const message = await parseErrorMessage(response);
    throw new HttpError(response.status, response.statusText, message);
  }

  if (response.status === 204) {
    return undefined as unknown as TRes;
  }

  return response.json() as Promise<TRes>;
}
