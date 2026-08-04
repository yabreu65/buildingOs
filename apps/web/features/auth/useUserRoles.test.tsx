/**
 * @jest-environment jsdom
 */

import { renderHook } from '@testing-library/react';
import { useAuth } from './useAuth';
import { useCanAccessAi, useUserRoles } from './useUserRoles';

jest.mock('./useAuth', () => ({
  useAuth: jest.fn(),
}));

const mockedUseAuth = jest.mocked(useAuth);

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
  ])('allows %s', (role) => {
    mockedUseAuth.mockReturnValue({
      currentUser: { roles: [role] },
    } as never);

    const { result } = renderHook(() => useCanAccessAi());

    expect(result.current).toBe(true);
  });

  it('denies residents', () => {
    mockedUseAuth.mockReturnValue({
      currentUser: { roles: ['RESIDENT'] },
    } as never);

    const { result } = renderHook(() => useCanAccessAi());

    expect(result.current).toBe(false);
  });
});
