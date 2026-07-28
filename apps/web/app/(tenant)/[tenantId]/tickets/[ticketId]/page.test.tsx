/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import TicketDetailPage from './page';
import * as ticketsHook from '@/features/tickets/hooks/useTicketDetail';
import * as ticketsApi from '@/features/tickets/services/tickets.api';
import * as authModule from '@/features/auth';
import * as reactQuery from '@tanstack/react-query';
import { residentTicketsPath } from '@/shared/lib/routes';

process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001';

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
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
  TicketDetail: ({
    ticket,
    variant,
    onAddComment,
    onBack,
  }: {
    ticket: { title: string };
    variant?: string;
    onAddComment?: (_ticketId: string, body: string) => Promise<void> | void;
    onBack?: () => void;
  }) => (
    <div data-testid="ticket-detail" data-variant={variant}>
      {ticket.title}
      <button type="button" onClick={() => onAddComment?.('ticket-1', 'Hola desde residente')}>Comentar</button>
      <button type="button" onClick={() => onBack?.()}>Volver</button>
    </div>
  ),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: jest.fn(),
}));

const mockedUseParams = jest.mocked(useParams);
const mockedUseRouter = jest.mocked(useRouter);
const mockedUseSearchParams = jest.mocked(useSearchParams);
const mockedUseTicketDetail = jest.mocked(ticketsHook.useTicketDetail);
const mockedAddComment = jest.mocked(ticketsApi.addComment);
const mockedUseAuth = jest.mocked(authModule.useAuth);
const mockedUseQueryClient = jest.mocked(reactQuery.useQueryClient);

describe('TicketDetailPage', () => {
  const invalidateQueries = jest.fn();
  const push = jest.fn();
  const loadedTicket = {
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
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseParams.mockReturnValue({ tenantId: 'tenant-1', ticketId: 'ticket-1' } as never);
    mockedUseRouter.mockReturnValue({ push, replace: jest.fn(), back: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() } as never);
    mockedUseSearchParams.mockReturnValue(new URLSearchParams() as never);
    mockedUseAuth.mockReturnValue({ currentUser: { roles: ['TENANT_ADMIN'] } } as never);
    mockedUseQueryClient.mockReturnValue({ invalidateQueries } as never);
  });

  function mockLoadedTicket() {
    mockedUseTicketDetail.mockReturnValue({
      data: loadedTicket,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as never);
  }

  it('loads the canonical ticket detail with tenantId and ticketId', () => {
    mockLoadedTicket();

    render(<TicketDetailPage />);

    expect(mockedUseTicketDetail).toHaveBeenCalledWith('tenant-1', 'ticket-1');
    expect(screen.getByTestId('ticket-detail').textContent).toContain('Fuga de agua');
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

  it.each([
    {
      title: 'uses resident context for a pure resident without query',
      roles: ['RESIDENT'],
      search: '',
      expectedPortal: 'resident',
      expectedFallback: residentTicketsPath('tenant-1'),
    },
    {
      title: 'uses resident context for a pure resident with resident query',
      roles: ['RESIDENT'],
      search: 'portal=resident',
      expectedPortal: 'resident',
      expectedFallback: residentTicketsPath('tenant-1'),
    },
    {
      title: 'uses admin context for a pure tenant admin even with resident query',
      roles: ['TENANT_ADMIN'],
      search: 'portal=resident',
      expectedPortal: 'admin',
      expectedFallback: '/tenant-1/tickets',
    },
    {
      title: 'uses admin context for a pure super admin even with resident query',
      roles: ['SUPER_ADMIN'],
      search: 'portal=resident',
      expectedPortal: 'admin',
      expectedFallback: '/tenant-1/tickets',
    },
    {
      title: 'uses resident context for a mixed resident plus tenant admin when resident query is present',
      roles: ['RESIDENT', 'TENANT_ADMIN'],
      search: 'portal=resident',
      expectedPortal: 'resident',
      expectedFallback: residentTicketsPath('tenant-1'),
    },
    {
      title: 'uses admin context for a mixed resident plus tenant admin without query',
      roles: ['RESIDENT', 'TENANT_ADMIN'],
      search: '',
      expectedPortal: 'admin',
      expectedFallback: '/tenant-1/tickets',
    },
    {
      title: 'uses resident context for a mixed resident plus super admin when resident query is present',
      roles: ['RESIDENT', 'SUPER_ADMIN'],
      search: 'portal=resident',
      expectedPortal: 'resident',
      expectedFallback: residentTicketsPath('tenant-1'),
    },
    {
      title: 'uses admin context for a mixed resident plus super admin without query',
      roles: ['RESIDENT', 'SUPER_ADMIN'],
      search: '',
      expectedPortal: 'admin',
      expectedFallback: '/tenant-1/tickets',
    },
  ])('$title', async ({ roles, search, expectedPortal, expectedFallback }) => {
    mockedUseSearchParams.mockReturnValue(new URLSearchParams(search) as never);
    mockedUseAuth.mockReturnValue({ currentUser: { roles } } as never);
    mockLoadedTicket();

    render(<TicketDetailPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Comentar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Volver' }));

    await waitFor(() => {
      expect(mockedAddComment).toHaveBeenCalledWith('building-1', 'ticket-1', { body: 'Hola desde residente' }, expectedPortal);
      expect(push).toHaveBeenCalledWith(expectedFallback);
    });
  });
});
