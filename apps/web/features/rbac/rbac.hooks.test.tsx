/** @jest-environment jsdom */
import { renderHook } from '@testing-library/react';
import type { AuthSession, Role } from '../auth/auth.types';
import { getSession } from '../auth/session.storage';
import { useCan } from './rbac.hooks';

jest.mock('../auth/session.storage', () => ({ getSession: jest.fn() }));

const mockedGetSession = jest.mocked(getSession);

function session(activeRole: Role, routedRole: Role): AuthSession {
  return {
    user: { id: 'user-1', email: 'user@example.com', name: 'User' },
    activeTenantId: 'tenant-a',
    memberships: [
      { tenantId: 'tenant-a', roles: [activeRole] },
      { tenantId: 'tenant-b', roles: [routedRole] },
    ],
  };
}

describe('useCan', () => {
  it.each([
    ['TENANT_ADMIN', 'OPERATOR', false],
    ['OPERATOR', 'TENANT_ADMIN', true],
  ] as const)('uses routed tenant membership when active=%s and routed=%s', (activeRole, routedRole, expected) => {
    mockedGetSession.mockReturnValue(session(activeRole, routedRole));
    expect(renderHook(() => useCan('finance.settings.write', 'tenant-b')).result.current).toBe(expected);
  });

  it('retains active tenant behavior when tenant is omitted or matches the route', () => {
    mockedGetSession.mockReturnValue(session('TENANT_ADMIN', 'OPERATOR'));
    expect(renderHook(() => useCan('finance.settings.write')).result.current).toBe(true);
    expect(renderHook(() => useCan('finance.settings.write', 'tenant-a')).result.current).toBe(true);
  });
});
