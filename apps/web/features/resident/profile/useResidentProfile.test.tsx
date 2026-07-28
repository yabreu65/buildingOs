import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { useRefreshSession } from '@/features/auth/useRefreshSession';
import { getResidentProfile, updateResidentProfile } from './resident-profile.api';
import { residentProfileKeys, useResidentProfile } from './useResidentProfile';

type MockSession = NonNullable<ReturnType<typeof useAuthSession>>;

jest.mock('@/features/auth/useAuthSession', () => ({
  useAuthSession: jest.fn(),
}));

jest.mock('@/features/auth/useRefreshSession', () => ({
  useRefreshSession: jest.fn(),
}));

jest.mock('./resident-profile.api', () => ({
  getResidentProfile: jest.fn(),
  updateResidentProfile: jest.fn(),
}));

const mockedUseAuthSession = jest.mocked(useAuthSession);
const mockedUseRefreshSession = jest.mocked(useRefreshSession);
const mockedGetResidentProfile = jest.mocked(getResidentProfile);
const mockedUpdateResidentProfile = jest.mocked(updateResidentProfile);

function makeSession(overrides: Partial<MockSession> = {}): MockSession {
  return {
    user: { id: 'user-1', email: 'resident@test.com', name: 'Resident' },
    memberships: [
      {
        tenantId: 'tenant-1',
        roles: ['RESIDENT'],
      },
    ],
    activeTenantId: 'tenant-2',
    ...overrides,
  } as MockSession;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { Wrapper, queryClient };
}

describe('useResidentProfile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not query without tenantId', () => {
    mockedUseAuthSession.mockReturnValue(makeSession() as never);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useResidentProfile(null), {
      wrapper: Wrapper,
    });

    expect(result.current.canAccessProfile).toBe(false);
    expect(result.current.profileQuery.fetchStatus).toBe('idle');
    expect(mockedGetResidentProfile).not.toHaveBeenCalled();
  });

  it('does not query without userId', () => {
    mockedUseAuthSession.mockReturnValue(
      makeSession({ user: { id: '', email: 'resident@test.com', name: 'Resident' } }) as never,
    );

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useResidentProfile('tenant-1'), {
      wrapper: Wrapper,
    });

    expect(result.current.canAccessProfile).toBe(false);
    expect(result.current.profileQuery.fetchStatus).toBe('idle');
    expect(mockedGetResidentProfile).not.toHaveBeenCalled();
  });

  it('allows access when the tenant membership contains RESIDENT even if activeTenantId points elsewhere', async () => {
    mockedUseAuthSession.mockReturnValue(makeSession() as never);
    mockedGetResidentProfile.mockResolvedValue({
      id: 'member-1',
      tenantId: 'tenant-1',
      name: 'Resident One',
      email: 'resident@test.com',
      phone: null,
      role: 'RESIDENT',
      status: 'ACTIVE',
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    } as never);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useResidentProfile('tenant-1'), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(mockedGetResidentProfile).toHaveBeenCalledTimes(1);
    });

    expect(result.current.canAccessProfile).toBe(true);
    expect(result.current.hasResidentMembership).toBe(true);
  });

  it('allows access with mixed roles that include RESIDENT', async () => {
    mockedUseAuthSession.mockReturnValue(
      makeSession({
        memberships: [
          {
            tenantId: 'tenant-1',
            roles: ['RESIDENT', 'TENANT_ADMIN'],
          },
        ],
      }) as never,
    );
    mockedGetResidentProfile.mockResolvedValue({
      id: 'member-1',
      tenantId: 'tenant-1',
      name: 'Resident Prime',
      email: 'resident@test.com',
      phone: null,
      role: 'RESIDENT',
      status: 'ACTIVE',
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    } as never);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useResidentProfile('tenant-1'), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(mockedGetResidentProfile).toHaveBeenCalledTimes(1);
    });

    expect(result.current.canAccessProfile).toBe(true);
    expect(result.current.hasResidentMembership).toBe(true);
  });

  it('does not query when the membership belongs to another tenant', () => {
    mockedUseAuthSession.mockReturnValue(
      makeSession({
        memberships: [
          {
            tenantId: 'tenant-2',
            roles: ['RESIDENT'],
          },
        ],
      }) as never,
    );

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useResidentProfile('tenant-1'), {
      wrapper: Wrapper,
    });

    expect(result.current.canAccessProfile).toBe(false);
    expect(result.current.profileQuery.fetchStatus).toBe('idle');
    expect(mockedGetResidentProfile).not.toHaveBeenCalled();
  });

  it('does not query when the tenant membership does not include RESIDENT', () => {
    mockedUseAuthSession.mockReturnValue(
      makeSession({
        memberships: [
          {
            tenantId: 'tenant-1',
            roles: ['TENANT_ADMIN'],
          },
        ],
      }) as never,
    );

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useResidentProfile('tenant-1'), {
      wrapper: Wrapper,
    });

    expect(result.current.canAccessProfile).toBe(false);
    expect(result.current.profileQuery.fetchStatus).toBe('idle');
    expect(mockedGetResidentProfile).not.toHaveBeenCalled();
  });

  it('exposes a query key that includes tenantId and userId', () => {
    mockedUseAuthSession.mockReturnValue(makeSession() as never);

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useResidentProfile('tenant-1'), {
      wrapper: Wrapper,
    });

    expect(result.current.queryKey).toEqual(residentProfileKeys.profile('tenant-1', 'user-1'));
  });

  it('refetches when the authenticated user changes inside the same tenant', async () => {
    mockedUseAuthSession.mockReturnValue(
      makeSession({
        user: { id: 'user-1', email: 'resident1@test.com', name: 'Resident 1' },
      }) as never,
    );
    mockedGetResidentProfile
      .mockResolvedValueOnce({
        id: 'member-1',
        tenantId: 'tenant-1',
        name: 'Resident One',
        email: 'resident1@test.com',
        phone: null,
        role: 'RESIDENT',
        status: 'ACTIVE',
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:00.000Z',
      } as never)
      .mockResolvedValueOnce({
        id: 'member-2',
        tenantId: 'tenant-1',
        name: 'Resident Two',
        email: 'resident2@test.com',
        phone: null,
        role: 'RESIDENT',
        status: 'ACTIVE',
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:00.000Z',
      } as never);

    const { Wrapper } = createWrapper();
    const { result, rerender } = renderHook(
      ({ tenantId }: { tenantId: string | null }) => useResidentProfile(tenantId),
      {
        wrapper: Wrapper,
        initialProps: { tenantId: 'tenant-1' },
      },
    );

    await waitFor(() => {
      expect(result.current.profileQuery.data?.name).toBe('Resident One');
    });

    mockedUseAuthSession.mockReturnValue(
      makeSession({
        user: { id: 'user-2', email: 'resident2@test.com', name: 'Resident 2' },
      }) as never,
    );

    rerender({ tenantId: 'tenant-1' });

    await waitFor(() => {
      expect(result.current.profileQuery.data?.name).toBe('Resident Two');
    });

    expect(mockedGetResidentProfile).toHaveBeenCalledTimes(2);
  });

  it('updates only the matching resident profile cache entry and does not mutate the session user', async () => {
    const session = makeSession();
    mockedUseAuthSession.mockReturnValue(session as never);
    mockedGetResidentProfile.mockResolvedValue({
      id: 'member-1',
      tenantId: 'tenant-1',
      name: 'Resident One',
      email: 'resident@test.com',
      phone: null,
      role: 'RESIDENT',
      status: 'ACTIVE',
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    } as never);
    mockedUpdateResidentProfile.mockResolvedValue({
      id: 'member-1',
      tenantId: 'tenant-1',
      name: 'Resident Prime',
      email: 'resident@test.com',
      phone: '+584141111111',
      role: 'RESIDENT',
      status: 'ACTIVE',
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T01:00:00.000Z',
    } as never);

    const { Wrapper, queryClient } = createWrapper();
    queryClient.setQueryData(residentProfileKeys.profile('tenant-1', 'user-1'), {
      id: 'cached-member-1',
      tenantId: 'tenant-1',
      name: 'Resident One',
      email: 'resident@test.com',
      phone: null,
      role: 'RESIDENT',
      status: 'ACTIVE',
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    });
    queryClient.setQueryData(residentProfileKeys.profile('tenant-1', 'user-2'), {
      id: 'cached-member-2',
      tenantId: 'tenant-1',
      name: 'Resident Other',
      email: 'resident2@test.com',
      phone: null,
      role: 'RESIDENT',
      status: 'ACTIVE',
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
    });

    const { result } = renderHook(() => useResidentProfile('tenant-1'), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.profileQuery.data?.name).toBe('Resident One');
    });

    await act(async () => {
      await result.current.updateProfile.mutateAsync({ name: 'Resident Prime' });
    });

    expect(mockedUpdateResidentProfile).toHaveBeenCalledWith('tenant-1', { name: 'Resident Prime' });
    expect(queryClient.getQueryData(residentProfileKeys.profile('tenant-1', 'user-1'))).toMatchObject({
      name: 'Resident Prime',
      phone: '+584141111111',
    });
    expect(queryClient.getQueryData(residentProfileKeys.profile('tenant-1', 'user-2'))).toMatchObject({
      name: 'Resident Other',
    });
    expect(session.user.name).toBe('Resident');
    expect(mockedUseRefreshSession).not.toHaveBeenCalled();
  });
});
