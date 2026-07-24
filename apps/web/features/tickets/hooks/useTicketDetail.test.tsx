/**
 * @jest-environment jsdom
 */

import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTicketDetail, ticketDetailKeys } from './useTicketDetail';
import * as ticketsApi from '../services/tickets.api';

jest.mock('../services/tickets.api', () => ({
  getTicketByTenant: jest.fn(),
}));

const mockGetTicketByTenant = jest.mocked(ticketsApi.getTicketByTenant);

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useTicketDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTicketByTenant.mockResolvedValue({ id: 'ticket-1' } as never);
  });

  it('builds the canonical tenant-scoped query key', () => {
    expect(ticketDetailKeys.byTenant('tenant-1', 'ticket-1')).toEqual(['ticket-detail', 'tenant-1', 'ticket-1']);
  });

  it('fetches the ticket with tenantId and ticketId', async () => {
    const { result } = renderHook(() => useTicketDetail('tenant-1', 'ticket-1'), { wrapper: wrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGetTicketByTenant).toHaveBeenCalledWith('tenant-1', 'ticket-1');
  });
});
