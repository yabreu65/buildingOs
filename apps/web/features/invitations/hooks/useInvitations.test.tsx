import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { invitationsApi } from '../services/invitations.api';
import { useInvitations } from './useInvitations';

jest.mock('../services/invitations.api', () => ({
  invitationsApi: {
    listMembers: jest.fn(),
    listInvitations: jest.fn(),
    createInvitation: jest.fn(),
    revokeInvitation: jest.fn(),
    resendInvitation: jest.fn(),
  },
}));

const mockedInvitationsApi = jest.mocked(invitationsApi);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe('useInvitations', () => {
  beforeEach(() => {
    mockedInvitationsApi.listMembers.mockReset();
    mockedInvitationsApi.listInvitations.mockReset();
    mockedInvitationsApi.createInvitation.mockReset();
    mockedInvitationsApi.revokeInvitation.mockReset();
    mockedInvitationsApi.resendInvitation.mockReset();
  });

  it('clears stale invitation state when the tenant changes', async () => {
    const membersDeferred = createDeferred<Array<{ id: string; email: string; name: string; createdAt: string; roles: string[] }>>();
    mockedInvitationsApi.listMembers.mockReturnValue(membersDeferred.promise as Promise<never>);
    mockedInvitationsApi.listInvitations.mockResolvedValue([]);

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ tenantId }) => useInvitations(tenantId),
      {
        wrapper,
        initialProps: { tenantId: 'tenant-1' },
      },
    );

    act(() => {
      void result.current.fetchMembers();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    await act(async () => {
      rerender({ tenantId: 'tenant-2' });
    });

    expect(result.current.members).toEqual([]);
    expect(result.current.pendingInvitations).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();

    await act(async () => {
      membersDeferred.resolve([
        {
          id: 'member-1',
          email: 'resident@example.com',
          name: 'Resident One',
          createdAt: '2026-07-31T00:00:00.000Z',
          roles: ['RESIDENT'],
        },
      ]);
      await membersDeferred.promise;
    });

    expect(result.current.members).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(mockedInvitationsApi.listMembers).toHaveBeenCalledTimes(1);
    expect(mockedInvitationsApi.listMembers).toHaveBeenCalledWith('tenant-1');
  });

  it('uses the latest tenant when creating a new invitation', async () => {
    mockedInvitationsApi.createInvitation.mockResolvedValue({
      id: 'invite-1',
      email: 'resident@example.com',
      expiresAt: '2026-08-01T00:00:00.000Z',
    });
    mockedInvitationsApi.listInvitations.mockResolvedValue([]);
    mockedInvitationsApi.listMembers.mockResolvedValue([]);

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ tenantId }) => useInvitations(tenantId),
      {
        wrapper,
        initialProps: { tenantId: 'tenant-1' },
      },
    );

    await act(async () => {
      rerender({ tenantId: 'tenant-2' });
    });

    await act(async () => {
      await result.current.createInvitation({
        email: 'resident@example.com',
        roles: ['RESIDENT'],
      });
    });

    expect(mockedInvitationsApi.createInvitation).toHaveBeenCalledWith('tenant-2', {
      email: 'resident@example.com',
      roles: ['RESIDENT'],
    });
  });
});
