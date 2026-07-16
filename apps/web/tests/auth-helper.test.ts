import type { Page } from '@playwright/test';

process.env.TEST_E2E_PASSWORD = 'TestPass123!';

jest.mock('@playwright/test', () => ({
  expect: jest.fn(),
}));

const { login, TEST_USERS } = require('../tests/e2e/helpers/auth') as typeof import('../tests/e2e/helpers/auth');

interface MockResponse {
  ok: boolean;
  status: number;
  text: string;
}

function createResponse(response: MockResponse): Response {
  return {
    ok: () => response.ok,
    status: () => response.status,
    statusText: response.status === 401 ? 'Unauthorized' : 'OK',
    text: async () => response.text,
  } as unknown as Response;
}

function createMockPage(options?: {
  readonly loginResponse?: MockResponse;
  readonly sessionResponse?: MockResponse;
  readonly sessionRejects?: Error;
  readonly finalUrl?: string;
}): Page & {
  request: {
    get: jest.Mock;
  };
  evaluate: jest.Mock;
} {
  const loginResponse = createResponse(
    options?.loginResponse ?? {
      ok: true,
      status: 201,
      text: JSON.stringify({ ok: true }),
    },
  );

  const sessionResponse = createResponse(
    options?.sessionResponse ?? {
      ok: true,
      status: 200,
      text: JSON.stringify({ user: { id: 'user-1' } }),
    },
  );

  const page = {
    goto: jest.fn().mockResolvedValue(undefined),
    fill: jest.fn().mockResolvedValue(undefined),
    getByRole: jest.fn().mockReturnValue({ click: jest.fn().mockResolvedValue(undefined) }),
    waitForResponse: jest.fn().mockResolvedValue(loginResponse),
    waitForURL: jest.fn().mockResolvedValue(undefined),
    context: jest.fn().mockReturnValue({
      cookies: jest.fn().mockResolvedValue([
        { name: 'bo_access_token' },
        { name: 'bo_refresh_token' },
      ]),
    }),
    request: {
      get: jest.fn(),
    },
    evaluate: jest.fn(),
    url: jest.fn().mockReturnValue(
      options?.finalUrl ?? 'http://localhost:3000/cmrnigdhz0008qb1f1hyjn717/dashboard',
    ),
  } as unknown as Page & {
    request: {
      get: jest.Mock;
    };
    evaluate: jest.Mock;
  };

  if (options?.sessionRejects) {
    page.request.get.mockRejectedValue(options.sessionRejects);
  } else {
    page.request.get.mockResolvedValue(sessionResponse);
  }

  return page;
}

describe('auth E2E helper', () => {
  it('logs in successfully and probes session through the request context', async () => {
    const page = createMockPage();

    const tenantId = await login(page, TEST_USERS.tenantAdminA);

    expect(tenantId).toBe('cmrnigdhz0008qb1f1hyjn717');
    expect(page.request.get).toHaveBeenCalledTimes(1);
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('fails fast when the login response is unauthorized', async () => {
    const page = createMockPage({
      loginResponse: {
        ok: false,
        status: 401,
        text: JSON.stringify({ message: 'Invalid credentials' }),
      },
    });

    await expect(login(page, TEST_USERS.tenantAdminA)).rejects.toThrow(
      /AUTH_LOGIN_FAILED status=401 endpoint=\/auth\/login message=\{"message":"Invalid credentials"\}/,
    );
  });

  it('reports a controlled error when the session probe endpoint is unavailable', async () => {
    const page = createMockPage({
      sessionRejects: new Error('connect ECONNREFUSED 127.0.0.1:4000'),
    });

    await expect(login(page, TEST_USERS.tenantAdminA)).rejects.toThrow(
      /AUTH_SESSION_FAILED status=0 endpoint=\/auth\/me/,
    );
  });
});
