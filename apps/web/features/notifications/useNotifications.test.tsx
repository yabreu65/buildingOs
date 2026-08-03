/**
 * @jest-environment jsdom
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAuthSession } from '@/features/auth/useAuthSession';
import * as api from './notifications.api';
import { useNotifications } from './useNotifications';

jest.mock('@/features/auth/useAuthSession', () => ({
  useAuthSession: jest.fn(),
}));

jest.mock('./notifications.api', () => ({
  listNotifications: jest.fn(),
  getUnreadCount: jest.fn(),
  markAsRead: jest.fn(),
  markAllAsRead: jest.fn(),
  deleteNotification: jest.fn(),
}));

const mockedUseAuthSession = jest.mocked(useAuthSession);
const mockedApi = jest.mocked(api);

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAuthSession.mockReturnValue({
      user: { id: 'user-1', email: 'resident@test.com', name: 'Resident' },
      memberships: [{ tenantId: 'tenant-1', roles: ['RESIDENT'] }],
      activeTenantId: 'tenant-1',
    });
    mockedApi.getUnreadCount.mockResolvedValue(0);
    mockedApi.listNotifications.mockResolvedValue({ notifications: [], total: 0 });
    mockedApi.markAsRead.mockResolvedValue({
      id: 'n-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      type: 'TICKET_STATUS_CHANGED',
      title: 'Updated',
      body: 'Updated',
      deliveryMethods: ['IN_APP'],
      isRead: true,
      createdAt: '2026-08-03T00:00:00.000Z',
    });
    mockedApi.markAllAsRead.mockResolvedValue({ success: true });
  });

  it('caches notification queries by tenant and user identity', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useNotifications('tenant-1'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.fetch({ take: 20 });
    });

    const cacheKeys = queryClient.getQueryCache().getAll().map((query) => query.queryKey);
    expect(cacheKeys).toEqual(
      expect.arrayContaining([
        ['notifications', 'tenant-1', 'user-1', 'unread-count'],
        ['notifications', 'tenant-1', 'user-1', 'list', null, null, 0, 20],
      ]),
    );
  });

  it('keeps unread count and list requests independent for the same identity', async () => {
    let resolveUnread!: (value: number) => void;
    const unreadPromise = new Promise<number>((resolve) => {
      resolveUnread = resolve;
    });

    mockedApi.getUnreadCount.mockReturnValue(unreadPromise);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useNotifications('tenant-1'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      const fetchPromise = result.current.fetch({ take: 20 });
      await Promise.resolve();
      resolveUnread(4);
      await fetchPromise;
    });

    await waitFor(() => {
      expect(result.current.unreadCount).toBe(4);
    });
  });

  it('drops the previous principal notification cache when the authenticated user changes', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const removeQueriesSpy = jest.spyOn(queryClient, 'removeQueries');

    const { result, rerender } = renderHook(() => useNotifications('tenant-1'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.fetch({ take: 20 });
    });

    mockedUseAuthSession.mockReturnValue({
      user: { id: 'user-2', email: 'resident2@test.com', name: 'Resident 2' },
      memberships: [{ tenantId: 'tenant-1', roles: ['RESIDENT'] }],
      activeTenantId: 'tenant-1',
    });

    rerender();

    await waitFor(() => {
      expect(removeQueriesSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ['notifications', 'tenant-1', 'user-1'],
        }),
      );
    });

    await waitFor(() => {
      expect(result.current.notifications).toEqual([]);
      expect(result.current.total).toBe(0);
    });

    removeQueriesSpy.mockRestore();
  });
});
