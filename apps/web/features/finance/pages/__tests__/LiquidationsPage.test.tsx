import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { apiClient } from '@/shared/lib/http/client';
import { LiquidationsPage } from '../LiquidationsPage';

jest.mock('@/shared/lib/http/client', () => ({
  apiClient: jest.fn(),
}));

const mockedApiClient = jest.mocked(apiClient);

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LiquidationsPage tenantId="tenant-1" />
    </QueryClientProvider>,
  );
}

describe('LiquidationsPage', () => {
  beforeEach(() => {
    mockedApiClient.mockReset();
  });

  it('shows an error without falling back to the empty state', async () => {
    mockedApiClient
      .mockResolvedValueOnce([{ id: 'building-1', name: 'Tower One' }])
      .mockRejectedValueOnce(new Error('boom'));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Error al cargar liquidaciones')).toBeTruthy();
    });

    expect(screen.queryByText('No hay liquidaciones aún')).toBeNull();
  });

  it('shows the empty state when the backend returns no liquidations', async () => {
    mockedApiClient
      .mockResolvedValueOnce([{ id: 'building-1', name: 'Tower One' }])
      .mockResolvedValueOnce([]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No hay liquidaciones aún')).toBeTruthy();
    });
  });
});
