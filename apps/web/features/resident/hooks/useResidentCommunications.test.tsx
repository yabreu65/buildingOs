import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { getResidentCommunications } from '../api/resident-context.api';
import { useResidentCommunications } from './useResidentCommunications';

jest.mock('@/features/auth/useAuthSession', () => ({
  useAuthSession: jest.fn(),
}));

jest.mock('../api/resident-context.api', () => ({
  getResidentCommunications: jest.fn(),
}));

const mockedUseAuthSession = jest.mocked(useAuthSession);
const mockedGetResidentCommunications = jest.mocked(getResidentCommunications);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useResidentCommunications', () => {
  beforeEach(() => {
    mockedUseAuthSession.mockReset();
    mockedGetResidentCommunications.mockReset();
  });

  it('loads communications using the active tenant instead of the route tenant alone', async () => {
    mockedUseAuthSession.mockReturnValue({
      user: { id: 'user-1', email: 'resident@buildingos.test', name: 'Resident' },
      memberships: [],
      activeTenantId: 'tenant-1',
    });
    mockedGetResidentCommunications.mockResolvedValue([]);

    const wrapper = createWrapper();
    const { result } = renderHook(() => useResidentCommunications('tenant-1', 7), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockedGetResidentCommunications).toHaveBeenCalledWith('tenant-1', 7);
  });

  it('fetches communications for the resident route even when activeTenantId points elsewhere', async () => {
    mockedUseAuthSession.mockReturnValue({
      user: { id: 'user-1', email: 'resident@buildingos.test', name: 'Resident' },
      memberships: [],
      activeTenantId: 'tenant-current',
    });
    mockedGetResidentCommunications.mockResolvedValue([]);

    const wrapper = createWrapper();
    const { result } = renderHook(() => useResidentCommunications('tenant-previous', 3), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockedGetResidentCommunications).toHaveBeenCalledWith('tenant-previous', 3);
  });
});
