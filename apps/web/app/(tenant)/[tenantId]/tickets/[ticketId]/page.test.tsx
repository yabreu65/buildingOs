/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import { useParams, useRouter } from 'next/navigation';
import TicketDetailPage from './page';
import * as ticketsHook from '@/features/tickets/hooks/useTicketDetail';
import * as authModule from '@/features/auth';
import * as reactQuery from '@tanstack/react-query';

process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001';

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
  useRouter: jest.fn(),
}));

jest.mock('@/features/tickets/hooks/useTicketDetail', () => ({
  useTicketDetail: jest.fn(),
  ticketDetailKeys: {
    byTenant: jest.fn((tenantId: string, ticketId: string) => ['ticket-detail', tenantId, ticketId]),
  },
}));

jest.mock('@/features/tickets/services/tickets.api', () => ({
  addComment: jest.fn(),
  updateTicket: jest.fn(),
}));

jest.mock('@/features/auth', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/features/tickets', () => ({
  TicketDetail: ({ ticket, variant }: { ticket: { title: string }; variant?: string }) => (
    <div data-testid="ticket-detail" data-variant={variant}>{ticket.title}</div>
  ),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: jest.fn(),
}));

const mockedUseParams = jest.mocked(useParams);
const mockedUseRouter = jest.mocked(useRouter);
const mockedUseTicketDetail = jest.mocked(ticketsHook.useTicketDetail);
const mockedUseAuth = jest.mocked(authModule.useAuth);
const mockedUseQueryClient = jest.mocked(reactQuery.useQueryClient);

describe('TicketDetailPage', () => {
  const invalidateQueries = jest.fn();
  const push = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseParams.mockReturnValue({ tenantId: 'tenant-1', ticketId: 'ticket-1' } as never);
    mockedUseRouter.mockReturnValue({ push, replace: jest.fn(), back: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() } as never);
    mockedUseAuth.mockReturnValue({ currentUser: { roles: ['TENANT_ADMIN'] } } as never);
    mockedUseQueryClient.mockReturnValue({ invalidateQueries } as never);
  });

  it('loads the canonical ticket detail with tenantId and ticketId', () => {
    mockedUseTicketDetail.mockReturnValue({
      data: {
        id: 'ticket-1',
        title: 'Fuga de agua',
        description: 'Detalle',
        status: 'OPEN',
        priority: 'MEDIUM',
        category: 'MAINTENANCE',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        closedAt: null,
        createdBy: { id: 'user-1', name: 'Usuario' },
        assignedTo: null,
        building: { id: 'building-1', name: 'Building One' },
        unit: { id: 'unit-1', label: '101', code: 'A01' },
        comments: [],
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as never);

    render(<TicketDetailPage />);

    expect(mockedUseTicketDetail).toHaveBeenCalledWith('tenant-1', 'ticket-1');
    expect(screen.getByTestId('ticket-detail').textContent).toBe('Fuga de agua');
    expect(screen.getByTestId('ticket-detail').getAttribute('data-variant')).toBe('page');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Detalle del ticket');
  });

  it('shows loading state', () => {
    mockedUseTicketDetail.mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: jest.fn() } as never);

    render(<TicketDetailPage />);

    expect(screen.getByText('Cargando ticket...')).toBeTruthy();
  });

  it('shows not found and forbidden states', () => {
    mockedUseTicketDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: Object.assign(new Error('Not found'), { status: 404 }),
      refetch: jest.fn(),
    } as never);

    const { rerender } = render(<TicketDetailPage />);
    expect(screen.getByText('Ticket no encontrado')).toBeTruthy();

    mockedUseTicketDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: Object.assign(new Error('Forbidden'), { status: 403 }),
      refetch: jest.fn(),
    } as never);

    rerender(<TicketDetailPage />);
    expect(screen.getByText('Acceso denegado')).toBeTruthy();
  });
});
