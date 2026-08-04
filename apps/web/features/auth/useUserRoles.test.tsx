/**
 * @jest-environment jsdom
 */

import { renderHook } from '@testing-library/react';
import { useAuth } from './useAuth';
import { useCanAccessAi, useUserRoles } from './useUserRoles';
import { useAuthSession } from './useAuthSession';

jest.mock('./useAuth', () => ({
  useAuth: jest.fn(),
}));

jest.mock('./useAuthSession', () => ({
  useAuthSession: jest.fn(),
}));

const mockedUseAuth = jest.mocked(useAuth);
const mockedUseAuthSession = jest.mocked(useAuthSession);

describe('useUserRoles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns an empty array when the user has no roles', () => {
    mockedUseAuth.mockReturnValue({ currentUser: null } as never);

    const { result } = renderHook(() => useUserRoles());

    expect(result.current).toEqual([]);
  });

  it('returns the current user roles', () => {
    mockedUseAuth.mockReturnValue({
      currentUser: { roles: ['TENANT_ADMIN', 'OPERATOR'] },
    } as never);

    const { result } = renderHook(() => useUserRoles());

    expect(result.current).toEqual(['TENANT_ADMIN', 'OPERATOR']);
  });
});

describe('useCanAccessAi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['TENANT_OWNER'],
    ['TENANT_ADMIN'],
    ['OPERATOR'],
  ])('allows %s for the matching tenant membership', (role) => {
    mockedUseAuthSession.mockReturnValue({
      activeTenantId: 'tenant-1',
      memberships: [{ tenantId: 'tenant-1', roles: [role] }],
    } as never);

    const { result } = renderHook(() => useCanAccessAi('tenant-1'));

    expect(result.current).toBe(true);
  });

  it('denies residents for the matching tenant membership', () => {
    mockedUseAuthSession.mockReturnValue({
      activeTenantId: 'tenant-1',
      memberships: [{ tenantId: 'tenant-1', roles: ['RESIDENT'] }],
    } as never);

    const { result } = renderHook(() => useCanAccessAi('tenant-1'));

    expect(result.current).toBe(false);
  });

  it('denies a different tenant even when the active tenant has admin access', () => {
    mockedUseAuthSession.mockReturnValue({
      activeTenantId: 'tenant-1',
      memberships: [
        { tenantId: 'tenant-1', roles: ['TENANT_ADMIN'] },
        { tenantId: 'tenant-2', roles: ['RESIDENT'] },
      ],
    } as never);

    const { result } = renderHook(() => useCanAccessAi('tenant-2'));

    expect(result.current).toBe(false);
  });

  it('denies when no tenant is provided', () => {
    mockedUseAuthSession.mockReturnValue({
      activeTenantId: 'tenant-1',
      memberships: [{ tenantId: 'tenant-1', roles: ['TENANT_ADMIN'] }],
    } as never);

    const { result } = renderHook(() => useCanAccessAi(undefined));

    expect(result.current).toBe(false);
  });
});
