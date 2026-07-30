import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { useAuthSession } from '@/features/auth/useAuthSession';
import {
  getInbox,
  markAsRead as markAsReadAPI,
} from '../services/communications.api';
import { useCommunicationsInbox } from './useCommunicationsInbox';

jest.mock('@/features/auth/useAuthSession', () => ({
  useAuthSession: jest.fn(),
}));

jest.mock('../services/communications.api', () => ({
  getInbox: jest.fn(),
  markAsRead: jest.fn(),
}));

const mockedUseAuthSession = jest.mocked(useAuthSession);
const mockedGetInbox = jest.mocked(getInbox);
const mockedMarkAsReadAPI = jest.mocked(markAsReadAPI);

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

describe('useCommunicationsInbox', () => {
  beforeEach(() => {
    mockedUseAuthSession.mockReset();
    mockedGetInbox.mockReset();
    mockedMarkAsReadAPI.mockReset();
  });

  it('loads inbox messages for the active tenant and sends the tenant header', async () => {
    mockedUseAuthSession.mockReturnValue({
      user: { id: 'user-1', email: 'resident@buildingos.test', name: 'Resident' },
      memberships: [],
      activeTenantId: 'tenant-1',
    });
    mockedGetInbox.mockResolvedValue([]);

    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useCommunicationsInbox({ tenantId: 'tenant-1', buildingId: 'building-1', unitId: 'unit-1' }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockedGetInbox).toHaveBeenCalledWith('tenant-1', {
      buildingId: 'building-1',
      unitId: 'unit-1',
    });
    expect(result.current.inbox).toEqual([]);
  });

  it('clears transient inbox data when the active tenant changes', async () => {
    const session = {
      user: { id: 'user-1', email: 'resident@buildingos.test', name: 'Resident' },
      memberships: [],
      activeTenantId: 'tenant-1',
    };

    mockedUseAuthSession.mockImplementation(() => session);
    mockedGetInbox.mockResolvedValue([
      {
        id: 'comm-1',
        title: 'Tenant 1 notice',
        body: 'Hello tenant 1',
        channel: 'IN_APP',
        priority: 'NORMAL',
        status: 'SENT',
        buildingId: 'building-1',
        createdBy: { id: 'admin-1', name: 'Admin', email: 'admin@buildingos.test' },
        targets: [],
        receipts: [{ id: 'receipt-1', userId: 'user-1', readAt: undefined }],
        createdAt: '2026-07-30T00:00:00.000Z',
      },
    ]);

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ tenantId }) => useCommunicationsInbox({ tenantId, buildingId: 'building-1', unitId: 'unit-1' }),
      {
        wrapper,
        initialProps: { tenantId: 'tenant-1' },
      },
    );

    await waitFor(() => {
      expect(result.current.inbox).toHaveLength(1);
    });

    session.activeTenantId = 'tenant-2';
    rerender({ tenantId: 'tenant-1' });

    expect(result.current.inbox).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(mockedGetInbox).toHaveBeenCalledTimes(1);
  });

  it('marks a communication as read for the active tenant', async () => {
    mockedUseAuthSession.mockReturnValue({
      user: { id: 'user-1', email: 'resident@buildingos.test', name: 'Resident' },
      memberships: [],
      activeTenantId: 'tenant-1',
    });
    mockedGetInbox.mockResolvedValue([]);
    mockedMarkAsReadAPI.mockResolvedValue(undefined);

    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useCommunicationsInbox({ tenantId: 'tenant-1', buildingId: 'building-1', unitId: 'unit-1' }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await result.current.markAsRead('comm-1');

    expect(mockedMarkAsReadAPI).toHaveBeenCalledWith('tenant-1', 'comm-1');
  });
});
