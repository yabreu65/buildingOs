/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuthSession } from '@/features/auth/useAuthSession';
import type { AuthSession, Role } from './auth.types';
import { useAuthorizedPortalContext } from './useAuthorizedPortalContext';

let mockPathname = '/tenant-1/dashboard';
let mockSearchParams = '';
let mockSession: AuthSession | null = null;

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
  useSearchParams: jest.fn(),
}));

jest.mock('@/features/auth/useAuthSession', () => ({
  useAuthSession: jest.fn(),
}));

const mockedUsePathname = jest.mocked(usePathname);
const mockedUseSearchParams = jest.mocked(useSearchParams);
const mockedUseAuthSession = jest.mocked(useAuthSession);

function buildSession(
  memberships: Array<{ tenantId: string; roles: Role[] }>,
  activeTenantId = 'tenant-1',
): AuthSession {
  return {
    user: { id: 'user-1', email: 'test@test.com', name: 'Test User' },
    memberships,
    activeTenantId,
  };
}

function PortalContextProbe({ tenantId }: { tenantId?: string | null }) {
  const portalContext = useAuthorizedPortalContext(tenantId);
  return <div data-testid="portal-context">{portalContext ?? 'null'}</div>;
}

function renderProbe(tenantId?: string | null) {
  return render(<PortalContextProbe tenantId={tenantId} />);
}

describe('useAuthorizedPortalContext', () => {
  beforeEach(() => {
    mockPathname = '/tenant-1/dashboard';
    mockSearchParams = '';
    mockSession = buildSession([{ tenantId: 'tenant-1', roles: ['RESIDENT' as Role] }]);

    mockedUsePathname.mockReturnValue(mockPathname);
    mockedUseSearchParams.mockReturnValue(new URLSearchParams(mockSearchParams) as never);
    mockedUseAuthSession.mockReturnValue(mockSession);
  });

  it.each([
    '/tenant-1/buildings',
    '/tenant-1/units',
    '/tenant-1/finanzas',
    '/tenant-1/reports',
    '/tenant-1/settings/members',
    '/tenant-1/settings/team',
  ])('returns admin for %s', (pathname) => {
    mockSession = buildSession([{ tenantId: 'tenant-1', roles: ['TENANT_ADMIN' as Role] }]);
    mockedUseAuthSession.mockReturnValue(mockSession);
    mockPathname = pathname;
    mockedUsePathname.mockReturnValue(pathname);
    renderProbe('tenant-1');
    expect(screen.getByTestId('portal-context').textContent).toBe('admin');
  });

  it('returns resident for the resident route', () => {
    mockPathname = '/tenant-1/resident/dashboard';
    mockedUsePathname.mockReturnValue(mockPathname);

    renderProbe('tenant-1');

    expect(screen.getByTestId('portal-context').textContent).toBe('resident');
  });

  it('returns admin for a mixed user on an admin route', () => {
    mockSession = buildSession([
      { tenantId: 'tenant-1', roles: ['RESIDENT' as Role, 'TENANT_ADMIN' as Role] },
    ]);
    mockedUseAuthSession.mockReturnValue(mockSession);
    mockPathname = '/tenant-1/buildings';
    mockedUsePathname.mockReturnValue(mockPathname);

    renderProbe('tenant-1');

    expect(screen.getByTestId('portal-context').textContent).toBe('admin');
  });

  it('returns resident for a mixed user on a resident route', () => {
    mockSession = buildSession([
      { tenantId: 'tenant-1', roles: ['RESIDENT' as Role, 'TENANT_ADMIN' as Role] },
    ]);
    mockedUseAuthSession.mockReturnValue(mockSession);
    mockPathname = '/tenant-1/resident/payments';
    mockedUsePathname.mockReturnValue(mockPathname);

    renderProbe('tenant-1');

    expect(screen.getByTestId('portal-context').textContent).toBe('resident');
  });

  it('returns resident for a resident-only user on an admin route so the page can redirect safely', () => {
    mockSession = buildSession([{ tenantId: 'tenant-1', roles: ['RESIDENT' as Role] }]);
    mockedUseAuthSession.mockReturnValue(mockSession);
    mockPathname = '/tenant-1/buildings';
    mockedUsePathname.mockReturnValue(mockPathname);

    renderProbe('tenant-1');

    expect(screen.getByTestId('portal-context').textContent).toBe('resident');
  });

  it('returns null when the tenantId is missing or the user has no membership', () => {
    renderProbe(null);
    expect(screen.getByTestId('portal-context').textContent).toBe('null');
  });

  it('returns null when the user has no membership for the tenant', () => {
    mockSession = buildSession([{ tenantId: 'tenant-2', roles: ['TENANT_ADMIN' as Role] }]);
    mockedUseAuthSession.mockReturnValue(mockSession);
    renderProbe('tenant-1');

    expect(screen.getByTestId('portal-context').textContent).toBe('null');
  });

  it('resolves the portal from the route tenant even when activeTenantId points elsewhere', () => {
    mockSession = buildSession(
      [
        { tenantId: 'tenant-1', roles: ['RESIDENT' as Role] },
        { tenantId: 'tenant-2', roles: ['TENANT_ADMIN' as Role] },
      ],
      'tenant-2',
    );
    mockedUseAuthSession.mockReturnValue(mockSession);
    mockPathname = '/tenant-1/resident/dashboard';
    mockedUsePathname.mockReturnValue(mockPathname);

    renderProbe('tenant-1');

    expect(screen.getByTestId('portal-context').textContent).toBe('resident');
  });

  it('keeps the result stable regardless of membership order', () => {
    const memberships = [
      { tenantId: 'tenant-2', roles: ['TENANT_ADMIN' as Role] },
      { tenantId: 'tenant-1', roles: ['RESIDENT' as Role] },
    ];
    mockSession = buildSession(memberships, 'tenant-2');
    mockedUseAuthSession.mockReturnValue(mockSession);
    mockPathname = '/tenant-1/resident/payments';
    mockedUsePathname.mockReturnValue(mockPathname);

    renderProbe('tenant-1');

    expect(screen.getByTestId('portal-context').textContent).toBe('resident');
  });

  it('does not fall back to memberships[0] when resolving the active tenant portal', () => {
    mockSession = buildSession([
      { tenantId: 'tenant-1', roles: ['RESIDENT' as Role] },
      { tenantId: 'tenant-2', roles: ['TENANT_ADMIN' as Role] },
    ]);
    mockedUseAuthSession.mockReturnValue(mockSession);
    mockPathname = '/tenant-2/buildings';
    mockedUsePathname.mockReturnValue(mockPathname);

    renderProbe('tenant-2');

    expect(screen.getByTestId('portal-context').textContent).toBe('admin');
  });
});
