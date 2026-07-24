/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/shared/components/ui/Toast';
import { UnitTicketsList } from './UnitTicketsList';
import * as ticketsApi from '../services/tickets.api';
import type { Ticket, PaginatedTickets } from '../services/tickets.api';
import { ticketDetailPath } from '@/shared/lib/routes';

jest.mock('../services/tickets.api', () => ({
  listTickets: jest.fn(),
  addComment: jest.fn(),
  createTicket: jest.fn(),
}));

const mockListTickets = jest.mocked(ticketsApi.listTickets);

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

const mockTicket1: Ticket = {
  id: 'ticket-1',
  title: 'Fuga de agua en baño',
  description: 'Hay una fuga que gotea constantemente',
  status: 'OPEN',
  priority: 'HIGH',
  category: 'MAINTENANCE',
  createdAt: '2025-01-15T10:00:00Z',
  updatedAt: '2025-01-15T10:00:00Z',
  closedAt: null,
  createdBy: { id: 'user-1', name: 'Residente' },
  assignedTo: null,
  building: { id: 'b1', name: 'Edificio Test' },
  unit: { id: 'unit-1', label: 'Apt 101', code: '101' },
  comments: [],
};

const mockTicket2: Ticket = {
  id: 'ticket-2',
  title: 'Ruido en el pasillo',
  description: 'Se escucha ruido constante por la noche',
  status: 'IN_PROGRESS',
  priority: 'MEDIUM',
  category: 'COMPLAINT',
  createdAt: '2025-01-10T10:00:00Z',
  updatedAt: '2025-01-12T10:00:00Z',
  closedAt: null,
  createdBy: { id: 'user-1', name: 'Residente' },
  assignedTo: null,
  building: { id: 'b1', name: 'Edificio Test' },
  unit: { id: 'unit-1', label: 'Apt 101', code: '101' },
  comments: [
    { id: 'c1', body: 'Estamos revisando', author: { id: 'user-2', name: 'Admin' }, createdAt: '2025-01-11T10:00:00Z' },
  ],
};

const mockPaginatedTickets: PaginatedTickets = {
  tickets: [mockTicket1, mockTicket2],
  total: 2,
  page: 1,
  limit: 50,
  totalPages: 1,
};

describe('UnitTicketsList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListTickets.mockResolvedValue(mockPaginatedTickets);
  });

  it('renders visible "Ver reclamo" text as visible content (not only aria-label)', async () => {
    renderWithProviders(<UnitTicketsList tenantId="tenant-1" buildingId="b1" unitId="u1" />);

    await waitFor(() => {
      expect(screen.getAllByText('Ver reclamo')).toHaveLength(2);
    });

    const visibleTexts = screen.getAllByText('Ver reclamo');
    visibleTexts.forEach((el) => {
      expect(el.tagName).not.toBe('SCRIPT');
      expect(el.closest('[aria-hidden]')).toBeNull();
    });
  });

  it('renders ticket titles correctly', async () => {
    renderWithProviders(<UnitTicketsList tenantId="tenant-1" buildingId="b1" unitId="u1" />);

    await waitFor(() => {
      expect(screen.getByText('Fuga de agua en baño')).toBeTruthy();
      expect(screen.getByText('Ruido en el pasillo')).toBeTruthy();
    });
  });

  it('links each ticket to the canonical ticket detail route', async () => {
    renderWithProviders(<UnitTicketsList tenantId="tenant-1" buildingId="b1" unitId="u1" />);

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: /Ver reclamo/ })).toHaveLength(2);
    });

    const links = screen.getAllByRole('link', { name: /Ver reclamo/ });
    expect(links[0].getAttribute('href')).toBe(ticketDetailPath('tenant-1', 'ticket-1'));
    expect(links[1].getAttribute('href')).toBe(ticketDetailPath('tenant-1', 'ticket-2'));
  });

  it('does not render admin-only controls', async () => {
    renderWithProviders(<UnitTicketsList tenantId="tenant-1" buildingId="b1" unitId="u1" />);

    await waitFor(() => {
      expect(screen.getByText('Fuga de agua en baño')).toBeTruthy();
    });

    expect(screen.queryByText(/Asignar/)).toBeNull();
    expect(screen.queryByText(/Cambiar estado/)).toBeNull();
    expect(screen.queryByText(/Cerrar solicitud/)).toBeNull();
  });

  it('each ticket button is a single button element (no nested buttons)', async () => {
    renderWithProviders(<UnitTicketsList tenantId="tenant-1" buildingId="b1" unitId="u1" />);

    await waitFor(() => {
      expect(screen.getByText('Fuga de agua en baño')).toBeTruthy();
    });

    const outerLinks = screen.getAllByRole('link', { name: /Ver reclamo/ });
    outerLinks.forEach((link) => {
      const nestedButtons = link.querySelectorAll('button');
      expect(nestedButtons).toHaveLength(0);
    });
  });

  it('ticket link has a visible focusable class', async () => {
    renderWithProviders(<UnitTicketsList tenantId="tenant-1" buildingId="b1" unitId="u1" />);

    await waitFor(() => {
      expect(screen.getByText('Fuga de agua en baño')).toBeTruthy();
    });

    const links = screen.getAllByRole('link', { name: /Ver reclamo/ });
    links.forEach((link) => {
      expect(link.className).toContain('focus:ring-2');
    });
  });
});
