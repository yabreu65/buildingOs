import {
  resolveActiveTenantId,
  resolveAuthLandingRoute,
  resolveAuthorizedPortalContext,
  resolvePortalFromPathname,
} from './landing-route';
import { residentDashboard, tenantDashboard } from '@/shared/lib/routes';
import type { AuthSession } from './auth.types';

function buildSession(
  memberships: AuthSession['memberships'],
  activeTenantId = memberships[0]?.tenantId ?? '',
): AuthSession {
  return {
    user: {
      id: 'user-1',
      email: 'test@test.com',
      name: 'Test User',
    },
    memberships,
    activeTenantId,
  };
}

describe('landing-route', () => {
  it('resolves resident-only users to the resident dashboard', () => {
    const session = buildSession([{ tenantId: 'tenant-1', roles: ['RESIDENT'] }]);

    expect(resolveAuthLandingRoute({ session })).toBe(residentDashboard('tenant-1'));
  });

  it('resolves admin-only users to the tenant dashboard', () => {
    const session = buildSession([{ tenantId: 'tenant-1', roles: ['TENANT_ADMIN'] }]);

    expect(resolveAuthLandingRoute({ session })).toBe(tenantDashboard('tenant-1'));
  });

  it('keeps a mixed user on the last resident portal when it is still allowed', () => {
    const session = buildSession([
      { tenantId: 'tenant-1', roles: ['RESIDENT', 'TENANT_ADMIN'] },
    ]);

    expect(
      resolveAuthLandingRoute({
        session,
        preferredPortal: 'resident',
      }),
    ).toBe(residentDashboard('tenant-1'));
  });

  it('keeps a mixed user on the last admin portal when it is still allowed', () => {
    const session = buildSession([
      { tenantId: 'tenant-1', roles: ['RESIDENT', 'TENANT_ADMIN'] },
    ]);

    expect(
      resolveAuthLandingRoute({
        session,
        preferredPortal: 'admin',
      }),
    ).toBe(tenantDashboard('tenant-1'));
  });

  it('honors an explicit resident route when the membership allows it', () => {
    const session = buildSession([
      { tenantId: 'tenant-1', roles: ['RESIDENT', 'TENANT_ADMIN'] },
    ]);

    expect(
      resolveAuthLandingRoute({
        session,
        requestedPath: '/tenant-1/resident/dashboard',
      }),
    ).toBe('/tenant-1/resident/dashboard');
  });

  it('honors an explicit admin route when the membership allows it', () => {
    const session = buildSession([
      { tenantId: 'tenant-1', roles: ['RESIDENT', 'TENANT_ADMIN'] },
    ]);

    expect(
      resolveAuthLandingRoute({
        session,
        requestedPath: '/tenant-1/dashboard',
      }),
    ).toBe('/tenant-1/dashboard');
  });

  it('honors explicit portal query params on shared routes', () => {
    const session = buildSession([
      { tenantId: 'tenant-1', roles: ['RESIDENT', 'TENANT_ADMIN'] },
    ]);

    expect(
      resolveAuthLandingRoute({
        session,
        requestedPath: '/tenant-1/tickets/ticket-1?portal=resident',
      }),
    ).toBe('/tenant-1/tickets/ticket-1?portal=resident');
  });

  it.each([
    'https://example.com',
    'http://example.com',
    '//example.com',
    '\\\\example.com',
    'javascript:alert(1)',
    '/%2F%2Fexample.com',
    '/tenant-2/dashboard',
    '',
    '   ',
  ])('rejects unsafe next values: %s', (requestedPath) => {
    const session = buildSession([
      { tenantId: 'tenant-1', roles: ['RESIDENT', 'TENANT_ADMIN'] },
    ]);

    expect(
      resolveAuthLandingRoute({
        session,
        requestedPath,
        preferredPortal: 'resident',
      }),
    ).toBe(residentDashboard('tenant-1'));
  });

  it('falls back deterministically when the explicit route is not allowed', () => {
    const session = buildSession([
      { tenantId: 'tenant-1', roles: ['RESIDENT', 'TENANT_ADMIN'] },
    ]);

    expect(
      resolveAuthLandingRoute({
        session,
        requestedPath: '/tenant-1/resident/dashboard',
        preferredPortal: 'admin',
      }),
    ).toBe('/tenant-1/resident/dashboard');

    expect(
      resolveAuthLandingRoute({
        session,
        requestedPath: '/tenant-2/dashboard',
      }),
    ).toBe(tenantDashboard('tenant-1'));
  });

  it('returns the first valid tenant id from the preferred tenant list', () => {
    expect(
      resolveActiveTenantId(
        [
          { tenantId: 'tenant-1', roles: ['RESIDENT'] },
          { tenantId: 'tenant-2', roles: ['TENANT_ADMIN'] },
        ],
        ['tenant-3', 'tenant-2'],
      ),
    ).toBe('tenant-2');
  });

  it('detects portal context from a pathname', () => {
    expect(resolvePortalFromPathname('/tenant-1/resident/dashboard')).toBe('resident');
    expect(resolvePortalFromPathname('/tenant-1/dashboard')).toBe('admin');
    expect(resolvePortalFromPathname('/tenant-1/tickets/ticket-1', 'portal=resident')).toBe('resident');
    expect(resolvePortalFromPathname('/login')).toBeNull();
  });

  it('resolves the authorized portal context for mixed-role users from the active route', () => {
    const session = buildSession([
      { tenantId: 'tenant-1', roles: ['RESIDENT', 'TENANT_ADMIN'] },
    ]);

    expect(
      resolveAuthorizedPortalContext({
        session,
        tenantId: 'tenant-1',
        pathname: '/tenant-1/dashboard',
      }),
    ).toBe('admin');

    expect(
      resolveAuthorizedPortalContext({
        session,
        tenantId: 'tenant-1',
        pathname: '/tenant-1/resident/payments',
      }),
    ).toBe('resident');
  });

  it('returns null when tenantId is missing or does not belong to the session', () => {
    const session = buildSession([
      { tenantId: 'tenant-1', roles: ['RESIDENT'] },
      { tenantId: 'tenant-2', roles: ['TENANT_ADMIN'] },
    ]);

    expect(
      resolveAuthorizedPortalContext({
        session,
        pathname: '/tenant-1/dashboard',
      }),
    ).toBeNull();

    expect(
      resolveAuthorizedPortalContext({
        session,
        tenantId: 'tenant-2',
        pathname: '/tenant-1/dashboard',
      }),
    ).toBeNull();
  });

  it('falls back to the only portal a single-role user can access', () => {
    const residentSession = buildSession([{ tenantId: 'tenant-1', roles: ['RESIDENT'] }]);
    const adminSession = buildSession([{ tenantId: 'tenant-1', roles: ['TENANT_ADMIN'] }]);

    expect(
      resolveAuthorizedPortalContext({
        session: residentSession,
        tenantId: 'tenant-1',
        pathname: '/tenant-1/dashboard',
      }),
    ).toBe('resident');

    expect(
      resolveAuthorizedPortalContext({
        session: adminSession,
        tenantId: 'tenant-1',
        pathname: '/tenant-1/resident/dashboard',
      }),
    ).toBe('admin');
  });
});
