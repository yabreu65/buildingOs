import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { getResidentContext } from '../api/resident-context.api';
import { useResidentContext } from './useResidentContext';

jest.mock('@/features/auth/useAuthSession', () => ({
  useAuthSession: jest.fn(),
}));

jest.mock('../api/resident-context.api', () => ({
  getResidentContext: jest.fn(),
}));

const mockedUseAuthSession = jest.mocked(useAuthSession);
const mockedGetResidentContext = jest.mocked(getResidentContext);

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

describe('useResidentContext', () => {
  beforeEach(() => {
    mockedUseAuthSession.mockReset();
    mockedGetResidentContext.mockReset();
  });

  it('reloads the resident context when the logged-in user changes inside the same tenant', async () => {
    mockedUseAuthSession.mockReturnValue({
      user: { id: 'user-1', email: 'resident1@buildingos.test', name: 'Resident 1' },
      memberships: [],
      activeTenantId: 'tenant-1',
    });
    mockedGetResidentContext.mockResolvedValueOnce({
      tenantId: 'tenant-1',
      activeBuildingId: 'building-1',
      activeUnitId: 'unit-1',
    });
    mockedGetResidentContext.mockResolvedValueOnce({
      tenantId: 'tenant-1',
      activeBuildingId: 'building-1',
      activeUnitId: 'unit-2',
    });

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ tenantId }: { tenantId: string | null }) => useResidentContext(tenantId),
      {
        wrapper,
        initialProps: { tenantId: 'tenant-1' },
      },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual({
        tenantId: 'tenant-1',
        activeBuildingId: 'building-1',
        activeUnitId: 'unit-1',
      });
    });

    mockedUseAuthSession.mockReturnValue({
      user: { id: 'user-2', email: 'resident2@buildingos.test', name: 'Resident 2' },
      memberships: [],
      activeTenantId: 'tenant-1',
    });

    rerender({ tenantId: 'tenant-1' });

    await waitFor(() => {
      expect(result.current.data).toEqual({
        tenantId: 'tenant-1',
        activeBuildingId: 'building-1',
        activeUnitId: 'unit-2',
      });
    });

    expect(mockedGetResidentContext).toHaveBeenCalledTimes(2);
    expect(mockedGetResidentContext).toHaveBeenNthCalledWith(1, 'tenant-1');
    expect(mockedGetResidentContext).toHaveBeenNthCalledWith(2, 'tenant-1');
  });
});
