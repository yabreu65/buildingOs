/**
 * @jest-environment jsdom
 *
 * FIN-07CR2: prueba el hook de autoridad de tenant usado para gatear el
 * backfill legacy. `useHasAnyRoleInTenant` lee `membership.roles`, que el
 * backend construye SOLO con roles scopeType=TENANT (tenancy.service.ts).
 * Por lo tanto un admin con alcance BUILDING/UNIT no califica, y el control
 * permanece oculto (fail-closed).
 */

import { renderHook } from '@testing-library/react';
import { useHasAnyRoleInTenant } from './useEffectiveRole';
import { useAuthSession } from '@/features/auth/useAuthSession';

jest.mock('@/features/auth/useAuthSession', () => ({
  useAuthSession: jest.fn(),
}));

const mockedUseAuthSession = jest.mocked(useAuthSession);

function sessionWith(
  roles: string[],
  scopedRoles: unknown[],
  membershipTenantId = 'tenant-1',
) {
  return {
    user: { id: 'u1', email: 'a@b.c', name: 'A' },
    activeTenantId: 'tenant-1',
    memberships: [{ tenantId: membershipTenantId, roles, scopedRoles }],
  };
}

describe('useHasAnyRoleInTenant (FIN-07CR2 legacy backfill gate)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['TENANT_OWNER', ['TENANT_OWNER'], true],
    ['TENANT_ADMIN', ['TENANT_ADMIN'], true],
    ['OPERATOR', ['OPERATOR'], false],
    ['RESIDENT', ['RESIDENT'], false],
  ])('proves tenant-level OWNER/ADMIN authority (%s)', (_label, roles, expected) => {
    mockedUseAuthSession.mockReturnValue(sessionWith(roles, []) as never);

    const { result } = renderHook(() =>
      useHasAnyRoleInTenant('tenant-1', ['TENANT_OWNER', 'TENANT_ADMIN']),
    );

    expect(result.current).toBe(expected);
  });

  it('hides for a BUILDING-scoped admin (no tenant-scoped roles)', () => {
    mockedUseAuthSession.mockReturnValue(
      sessionWith([], [
        {
          id: 'r1',
          role: 'TENANT_ADMIN',
          scopeType: 'BUILDING',
          scopeBuildingId: 'b1',
          scopeUnitId: null,
        },
      ]) as never,
    );

    const { result } = renderHook(() =>
      useHasAnyRoleInTenant('tenant-1', ['TENANT_OWNER', 'TENANT_ADMIN']),
    );

    expect(result.current).toBe(false);
  });

  it('hides for a UNIT-scoped admin (no tenant-scoped roles)', () => {
    mockedUseAuthSession.mockReturnValue(
      sessionWith([], [
        {
          id: 'r1',
          role: 'TENANT_ADMIN',
          scopeType: 'UNIT',
          scopeBuildingId: null,
          scopeUnitId: 'u1',
        },
      ]) as never,
    );

    const { result } = renderHook(() =>
      useHasAnyRoleInTenant('tenant-1', ['TENANT_OWNER', 'TENANT_ADMIN']),
    );

    expect(result.current).toBe(false);
  });

  it('hides for a cross-tenant membership', () => {
    mockedUseAuthSession.mockReturnValue(
      sessionWith(['TENANT_ADMIN'], [], 'tenant-2') as never,
    );

    const { result } = renderHook(() =>
      useHasAnyRoleInTenant('tenant-1', ['TENANT_OWNER', 'TENANT_ADMIN']),
    );

    expect(result.current).toBe(false);
  });

  it('fails closed without a session or tenant', () => {
    mockedUseAuthSession.mockReturnValue(null as never);
    const { result } = renderHook(() =>
      useHasAnyRoleInTenant('tenant-1', ['TENANT_OWNER', 'TENANT_ADMIN']),
    );
    expect(result.current).toBe(false);

    mockedUseAuthSession.mockReturnValue(sessionWith(['TENANT_ADMIN'], []) as never);
    const { result: noTenant } = renderHook(() =>
      useHasAnyRoleInTenant(undefined, ['TENANT_OWNER', 'TENANT_ADMIN']),
    );
    expect(noTenant.current).toBe(false);
  });
});
