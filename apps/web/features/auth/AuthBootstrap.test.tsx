/**
 * @jest-environment jsdom
 */

import { render, waitFor } from '@testing-library/react';
import { usePathname, useRouter } from 'next/navigation';
import { AuthBootstrap } from './AuthBootstrap';
import { apiMe } from './auth.service';
import {
  clearAuth,
  clearSession,
  getLastTenant,
  getSession,
  setLastTenant,
  setSession,
} from './session.storage';
import { clearAllImpersonationData } from '../impersonation/impersonation.storage';
import { useToast } from '@/shared/components/ui/Toast';
import { reportFrontendError } from '@/shared/lib/observability/frontend-observability';
import { subscribeAuthUnauthorized } from '@/shared/lib/auth/events';
import { HttpError } from '@/shared/lib/http/client';

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
  useRouter: jest.fn(),
}));

jest.mock('@/shared/lib/public-api-url', () => ({
  getPublicApiUrl: () => 'http://localhost:4000',
}));

jest.mock('./auth.service', () => ({
  apiMe: jest.fn(),
}));

jest.mock('./session.storage', () => ({
  clearAuth: jest.fn(),
  clearSession: jest.fn(),
  getLastTenant: jest.fn(),
  getSession: jest.fn(),
  setLastTenant: jest.fn(),
  setSession: jest.fn(),
}));

jest.mock('../impersonation/impersonation.storage', () => ({
  clearAllImpersonationData: jest.fn(),
}));

jest.mock('@/shared/components/ui/Toast', () => ({
  useToast: jest.fn(),
}));

jest.mock('@/shared/lib/observability/frontend-observability', () => ({
  reportFrontendError: jest.fn(),
}));

jest.mock('@/shared/lib/auth/events', () => ({
  subscribeAuthUnauthorized: jest.fn(),
}));

const mockedUsePathname = jest.mocked(usePathname);
const mockedUseRouter = jest.mocked(useRouter);
const mockedApiMe = jest.mocked(apiMe);
const mockedClearAuth = jest.mocked(clearAuth);
const mockedClearSession = jest.mocked(clearSession);
const mockedGetLastTenant = jest.mocked(getLastTenant);
const mockedGetSession = jest.mocked(getSession);
const mockedSetLastTenant = jest.mocked(setLastTenant);
const mockedSetSession = jest.mocked(setSession);
const mockedClearAllImpersonationData = jest.mocked(clearAllImpersonationData);
const mockedUseToast = jest.mocked(useToast);
const mockedReportFrontendError = jest.mocked(reportFrontendError);
const mockedSubscribeAuthUnauthorized = jest.mocked(subscribeAuthUnauthorized);

function renderBootstrap(pathname = '/tenant-1/dashboard') {
  window.history.pushState({}, '', pathname);
  mockedUsePathname.mockReturnValue(pathname);
  const replace = jest.fn();
  mockedUseRouter.mockReturnValue({ replace } as never);
  mockedUseToast.mockReturnValue({ toast: jest.fn() } as never);
  mockedSubscribeAuthUnauthorized.mockReturnValue(jest.fn());

  render(<AuthBootstrap />);

  return { replace };
}

describe('AuthBootstrap', () => {
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    mockedApiMe.mockReset();
    mockedClearAuth.mockReset();
    mockedClearSession.mockReset();
    mockedGetLastTenant.mockReset();
    mockedGetSession.mockReset();
    mockedSetLastTenant.mockReset();
    mockedSetSession.mockReset();
    mockedClearAllImpersonationData.mockReset();
    mockedUseToast.mockReset();
    mockedReportFrontendError.mockReset();
    mockedSubscribeAuthUnauthorized.mockReset();
    consoleErrorSpy.mockClear();
    mockedGetLastTenant.mockReturnValue(null);
    mockedGetSession.mockReturnValue(null);
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('clears the local session and impersonation data when /auth/me returns 401', async () => {
    mockedApiMe.mockRejectedValue(new HttpError(401, 'Unauthorized', 'Unauthorized'));
    const { replace } = renderBootstrap();

    await waitFor(() => {
      expect(mockedClearAllImpersonationData).toHaveBeenCalledTimes(1);
      expect(mockedClearSession).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledTimes(1);
    });

    expect(mockedClearAuth).not.toHaveBeenCalled();
    expect(mockedSetSession).not.toHaveBeenCalled();
    expect(mockedSetLastTenant).not.toHaveBeenCalled();
    expect(mockedClearAllImpersonationData.mock.invocationCallOrder[0]).toBeLessThan(
      mockedClearSession.mock.invocationCallOrder[0],
    );
    expect(mockedClearSession.mock.invocationCallOrder[0]).toBeLessThan(
      replace.mock.invocationCallOrder[0],
    );
    expect(replace).toHaveBeenCalledWith('/login?next=%2Ftenant-1%2Fdashboard');
  });

  it('keeps public routes public when /auth/me returns 401', async () => {
    mockedApiMe.mockRejectedValue(new HttpError(401, 'Unauthorized', 'Unauthorized'));
    const { replace } = renderBootstrap('/login');

    await waitFor(() => {
      expect(mockedClearSession).toHaveBeenCalledTimes(1);
      expect(mockedClearAllImpersonationData).toHaveBeenCalledTimes(1);
    });

    expect(replace).not.toHaveBeenCalled();
  });

  it('preserves the existing non-401 handling for bootstrap failures', async () => {
    mockedApiMe.mockRejectedValue(new HttpError(500, 'Internal Server Error', 'Boom'));
    const { replace } = renderBootstrap();

    await waitFor(() => {
      expect(mockedReportFrontendError).toHaveBeenCalledTimes(1);
      expect(mockedClearSession).not.toHaveBeenCalled();
      expect(mockedClearAllImpersonationData).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
    });

    expect(mockedClearAuth).not.toHaveBeenCalled();
  });

  it('restores a valid session and persists the active tenant', async () => {
    mockedGetLastTenant.mockReturnValue('tenant-b');
    mockedGetSession.mockReturnValue(null);
    mockedApiMe.mockResolvedValue({
      user: { id: 'user-1', email: 'resident@test.com', name: 'Resident' },
      memberships: [
        { tenantId: 'tenant-a', roles: ['RESIDENT'] },
        { tenantId: 'tenant-b', roles: ['TENANT_ADMIN'] },
      ],
    });

    renderBootstrap();

    await waitFor(() => {
      expect(mockedSetSession).toHaveBeenCalledTimes(1);
      expect(mockedSetLastTenant).toHaveBeenCalledTimes(1);
    });

    expect(mockedClearSession).not.toHaveBeenCalled();
    expect(mockedClearAllImpersonationData).toHaveBeenCalledTimes(1);
    expect(mockedSetSession).toHaveBeenCalledWith({
      user: { id: 'user-1', email: 'resident@test.com', name: 'Resident' },
      memberships: [
        { tenantId: 'tenant-a', roles: ['RESIDENT'] },
        { tenantId: 'tenant-b', roles: ['TENANT_ADMIN'] },
      ],
      activeTenantId: 'tenant-b',
    });
    expect(mockedSetLastTenant).toHaveBeenCalledWith('tenant-b');
  });

  it('does not restore a stale session before the 401 cleanup runs', async () => {
    mockedApiMe.mockRejectedValue(new HttpError(401, 'Unauthorized', 'Unauthorized'));
    const { replace } = renderBootstrap();

    await waitFor(() => {
      expect(mockedClearSession).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledTimes(1);
    });

    expect(mockedSetSession).not.toHaveBeenCalled();
    expect(mockedSetLastTenant).not.toHaveBeenCalled();
    expect(mockedClearSession.mock.invocationCallOrder[0]).toBeLessThan(
      replace.mock.invocationCallOrder[0],
    );
  });

  it('keeps safe tenant preferences untouched by using clearSession instead of clearAuth', async () => {
    mockedApiMe.mockRejectedValue(new HttpError(401, 'Unauthorized', 'Unauthorized'));
    renderBootstrap();

    await waitFor(() => {
      expect(mockedClearSession).toHaveBeenCalledTimes(1);
      expect(mockedClearAuth).not.toHaveBeenCalled();
    });
  });
});
