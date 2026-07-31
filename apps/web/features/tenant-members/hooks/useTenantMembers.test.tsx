import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { tenantMembersApi } from '../api/tenant-members.api';
import { useAssignableResidents } from './useTenantMembers';

jest.mock('../api/tenant-members.api', () => ({
  tenantMembersApi: {
    getAssignableResidents: jest.fn(),
  },
}));

const mockedGetAssignableResidents = jest.mocked(tenantMembersApi.getAssignableResidents);

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

describe('useAssignableResidents', () => {
  beforeEach(() => {
    mockedGetAssignableResidents.mockReset();
  });

  it('does not call the API helper when the modal is disabled', async () => {
    const wrapper = createWrapper();

    renderHook(
      () => useAssignableResidents('tenant-1', 'unit-1', false),
      { wrapper },
    );

    await waitFor(() => {
      expect(mockedGetAssignableResidents).not.toHaveBeenCalled();
    });
  });

  it('calls the API helper when the modal is enabled', async () => {
    mockedGetAssignableResidents.mockResolvedValue([]);

    const wrapper = createWrapper();

    const { result } = renderHook(
      () => useAssignableResidents('tenant-1', 'unit-1', true),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockedGetAssignableResidents).toHaveBeenCalledWith('tenant-1', 'unit-1');
  });
});
