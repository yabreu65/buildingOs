import { apiClient } from './client';
import { clearAuth } from '@/features/auth/session.storage';
import { clearAllImpersonationData, getCurrentImpersonationToken } from '@/features/impersonation/impersonation.storage';
import { emitAuthUnauthorized } from '@/shared/lib/auth/events';

jest.mock('@/shared/lib/public-api-url', () => ({
  getPublicApiUrl: () => 'https://api.buildingos.test',
}));

jest.mock('@/shared/lib/observability/frontend-observability', () => ({
  recordApiResponseContext: jest.fn(),
}));

jest.mock('@/features/auth/session.storage', () => ({
  clearAuth: jest.fn(),
}));

jest.mock('@/features/impersonation/impersonation.storage', () => ({
  clearAllImpersonationData: jest.fn(),
  getCurrentImpersonationToken: jest.fn(),
}));

jest.mock('@/shared/lib/auth/events', () => ({
  emitAuthUnauthorized: jest.fn(),
}));

const mockedClearAuth = jest.mocked(clearAuth);
const mockedClearAllImpersonationData = jest.mocked(clearAllImpersonationData);
const mockedEmitAuthUnauthorized = jest.mocked(emitAuthUnauthorized);
const mockedGetCurrentImpersonationToken = jest.mocked(getCurrentImpersonationToken);

function jsonResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? 'Unauthorized' : 'OK',
    headers: {
      get: () => null,
    },
    async json() {
      return body ?? {};
    },
  } as unknown as Response;
}

describe('apiClient auth refresh single-flight', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockedClearAuth.mockReset();
    mockedClearAllImpersonationData.mockReset();
    mockedEmitAuthUnauthorized.mockReset();
    mockedGetCurrentImpersonationToken.mockReset();
    mockedGetCurrentImpersonationToken.mockReturnValue(null);
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('shares one refresh promise across simultaneous 401s and retries each request once', async () => {
    let refreshCalls = 0;
    let sawRefresh = false;
    const fetchMock = jest.mocked(global.fetch);

    fetchMock.mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        sawRefresh = true;
        return jsonResponse(201, { ok: true });
      }

      if (url.endsWith('/protected')) {
        if (!sawRefresh) {
          return jsonResponse(401, { message: 'Unauthorized' });
        }

        return jsonResponse(200, { ok: true, retried: true });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const requests = Array.from({ length: 5 }, () =>
      apiClient<{ ok: boolean; retried?: boolean }>({
        path: '/protected',
        method: 'GET',
      }),
    );

    const responses = await Promise.all(requests);

    expect(refreshCalls).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(11);
    expect(responses).toEqual([
      { ok: true, retried: true },
      { ok: true, retried: true },
      { ok: true, retried: true },
      { ok: true, retried: true },
      { ok: true, retried: true },
    ]);
    expect(mockedClearAuth).not.toHaveBeenCalled();
    expect(mockedClearAllImpersonationData).not.toHaveBeenCalled();
    expect(mockedEmitAuthUnauthorized).not.toHaveBeenCalled();
  });

  it('clears the session once when the shared refresh fails', async () => {
    let refreshCalls = 0;
    const fetchMock = jest.mocked(global.fetch);

    fetchMock.mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return jsonResponse(401, { message: 'refresh expired' });
      }

      if (url.endsWith('/protected')) {
        return jsonResponse(401, { message: 'Unauthorized' });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const requests = Array.from({ length: 5 }, () =>
      apiClient<{ ok: boolean }>({
        path: '/protected',
        method: 'GET',
      }),
    );

    await expect(Promise.all(requests)).rejects.toThrow(
      'Sesión expirada. Vuelve a iniciar sesión.',
    );

    expect(refreshCalls).toBe(1);
    expect(mockedClearAllImpersonationData).toHaveBeenCalledTimes(1);
    expect(mockedClearAuth).toHaveBeenCalledTimes(1);
    expect(mockedEmitAuthUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not refresh again when the retried request still returns 401', async () => {
    let refreshCalls = 0;
    let retryCalls = 0;
    const fetchMock = jest.mocked(global.fetch);

    fetchMock.mockImplementation(async (input) => {
      const url = String(input);

      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return jsonResponse(201, { ok: true });
      }

      if (url.endsWith('/protected')) {
        if (retryCalls === 0) {
          retryCalls += 1;
          return jsonResponse(401, { message: 'Unauthorized' });
        }

        return jsonResponse(401, { message: 'still unauthorized' });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await expect(
      apiClient<{ ok: boolean }>({
        path: '/protected',
        method: 'GET',
      }),
    ).rejects.toMatchObject({
      status: 401,
      message: 'still unauthorized',
    });

    expect(refreshCalls).toBe(1);
    expect(mockedClearAuth).not.toHaveBeenCalled();
    expect(mockedClearAllImpersonationData).not.toHaveBeenCalled();
    expect(mockedEmitAuthUnauthorized).not.toHaveBeenCalled();
  });

  it('keeps auth routes out of the refresh flow', async () => {
    const fetchMock = jest.mocked(global.fetch);

    fetchMock.mockImplementation(async (input) => {
      const url = String(input);

      if (
        url.endsWith('/auth/login') ||
        url.endsWith('/auth/logout') ||
        url.endsWith('/auth/refresh')
      ) {
        return jsonResponse(401, { message: `${url} rejected` });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    await expect(
      apiClient<{ ok: boolean }, { email: string; password: string }>({
        path: '/auth/login',
        method: 'POST',
        body: { email: 'user@example.com', password: 'secret' },
      }),
    ).rejects.toMatchObject({
      status: 401,
      message: 'https://api.buildingos.test/auth/login rejected',
    });

    await expect(
      apiClient<{ ok: boolean }>({
        path: '/auth/logout',
        method: 'POST',
      }),
    ).rejects.toMatchObject({
      status: 401,
      message: 'https://api.buildingos.test/auth/logout rejected',
    });

    await expect(
      apiClient<{ ok: boolean }>({
        path: '/auth/refresh',
        method: 'POST',
      }),
    ).rejects.toMatchObject({
      status: 401,
      message: 'https://api.buildingos.test/auth/refresh rejected',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('sends FormData bodies without forcing JSON content-type', async () => {
    const fetchMock = jest.mocked(global.fetch);
    const formData = new FormData();
    const file = new File(['workbook'], 'buildingos.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    formData.append('file', file);

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    await apiClient<{ ok: boolean }, FormData>({
      path: '/tenants/tenant-1/onboarding-imports/preview',
      method: 'POST',
      body: formData,
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect(init.body).toBe(formData as unknown as BodyInit);
  });

  it('can read blob responses', async () => {
    const fetchMock = jest.mocked(global.fetch);
    const response = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: () => 'application/octet-stream',
      },
      async blob() {
        return new Blob(['template-bytes'], {
          type: 'application/octet-stream',
        });
      },
      async json() {
        return {};
      },
      async text() {
        return 'template-bytes';
      },
      async arrayBuffer() {
        return new ArrayBuffer(0);
      },
    } as unknown as Response;

    fetchMock.mockResolvedValueOnce(response);

    const result = await apiClient<Blob>({
      path: '/tenants/tenant-1/onboarding-imports/template',
      method: 'GET',
      responseType: 'blob',
    });

    expect(result).toBeInstanceOf(Blob);
  });
});
