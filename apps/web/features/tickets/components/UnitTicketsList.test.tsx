/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/shared/components/ui/Toast';
import { UnitTicketsList } from './UnitTicketsList';
import * as ticketsApi from '../services/tickets.api';
import type { Ticket, PaginatedTickets } from '../services/tickets.api';

jest.mock('../services/tickets.api', () => ({
  listTickets: jest.fn(),
  getTicket: jest.fn(),
  addComment: jest.fn(),
  createTicket: jest.fn(),
}));

const mockListTickets = jest.mocked(ticketsApi.listTickets);
const mockGetTicket = jest.mocked(ticketsApi.getTicket);

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
    renderWithProviders(<UnitTicketsList buildingId="b1" unitId="u1" />);

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
    renderWithProviders(<UnitTicketsList buildingId="b1" unitId="u1" />);

    await waitFor(() => {
      expect(screen.getByText('Fuga de agua en baño')).toBeTruthy();
      expect(screen.getByText('Ruido en el pasillo')).toBeTruthy();
    });
  });

  it('calls openTicketDetail with correct ticketId when card is clicked', async () => {
    mockGetTicket.mockResolvedValue(mockTicket1);

    renderWithProviders(<UnitTicketsList buildingId="b1" unitId="u1" />);

    await waitFor(() => {
      expect(screen.getByText('Fuga de agua en baño')).toBeTruthy();
    });

    const buttons = screen.getAllByRole('button', { name: /Ver reclamo/ });
    expect(buttons).toHaveLength(2);

    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(mockGetTicket).toHaveBeenCalledWith('b1', 'ticket-1');
    });
  });

  it('does not render admin-only controls', async () => {
    renderWithProviders(<UnitTicketsList buildingId="b1" unitId="u1" />);

    await waitFor(() => {
      expect(screen.getByText('Fuga de agua en baño')).toBeTruthy();
    });

    expect(screen.queryByText(/Asignar/)).toBeNull();
    expect(screen.queryByText(/Cambiar estado/)).toBeNull();
    expect(screen.queryByText(/Cerrar solicitud/)).toBeNull();
  });

  it('each ticket button is a single button element (no nested buttons)', async () => {
    renderWithProviders(<UnitTicketsList buildingId="b1" unitId="u1" />);

    await waitFor(() => {
      expect(screen.getByText('Fuga de agua en baño')).toBeTruthy();
    });

    const outerButtons = screen.getAllByRole('button', { name: /Ver reclamo/ });
    outerButtons.forEach((btn) => {
      const nestedButtons = btn.querySelectorAll('button');
      expect(nestedButtons).toHaveLength(0);
    });
  });

  it('ticket button has cursor-pointer class', async () => {
    renderWithProviders(<UnitTicketsList buildingId="b1" unitId="u1" />);

    await waitFor(() => {
      expect(screen.getByText('Fuga de agua en baño')).toBeTruthy();
    });

    const buttons = screen.getAllByRole('button', { name: /Ver reclamo/ });
    buttons.forEach((btn) => {
      expect(btn.className).toContain('cursor-pointer');
    });
  });
});
