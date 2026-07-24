/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import TicketDetail from './TicketDetail';
import * as authModule from '@/features/auth';
import * as membershipsModule from '@/features/memberships/useAssignableTicketMembers';
import * as vendorsModule from '@/features/vendors';

jest.mock('@/features/auth', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/features/memberships/useAssignableTicketMembers', () => ({
  useAssignableTicketMembers: jest.fn(),
}));

jest.mock('@/features/vendors', () => ({
  useQuotes: jest.fn(),
  useWorkOrders: jest.fn(),
  QuoteCreateModal: () => null,
  WorkOrderCreateModal: () => null,
}));

jest.mock('../services/tickets.api', () => ({
  getTicketReplySuggestions: jest.fn(),
}));

jest.mock('@/shared/components/ui/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

const mockedUseAuth = jest.mocked(authModule.useAuth);
const mockedUseAssignableTicketMembers = jest.mocked(membershipsModule.useAssignableTicketMembers);
const mockedUseQuotes = jest.mocked(vendorsModule.useQuotes);
const mockedUseWorkOrders = jest.mocked(vendorsModule.useWorkOrders);

const ticket = {
  id: 'ticket-1',
  status: 'OPEN',
  priority: 'MEDIUM',
  title: 'Fuga de agua',
  description: 'Detalle del ticket',
  category: 'MAINTENANCE',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  closedAt: null,
  createdBy: { id: 'user-1', name: 'Usuario' },
  assignedTo: null,
  building: { id: 'building-1', name: 'Building One' },
  unit: { id: 'unit-1', label: '101', code: 'A01' },
  comments: [],
} as never;

describe('TicketDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAssignableTicketMembers.mockReturnValue({ data: [], isLoading: false } as never);
    mockedUseQuotes.mockReturnValue({ quotes: [], refetch: jest.fn() } as never);
    mockedUseWorkOrders.mockReturnValue({ workOrders: [], refetch: jest.fn() } as never);
  });

  it('hides administrative actions for residents', () => {
    mockedUseAuth.mockReturnValue({ currentUser: { roles: ['RESIDENT'] } } as never);

    render(
      <TicketDetail
        tenantId="tenant-1"
        ticket={ticket}
        variant="page"
        onBack={jest.fn()}
        onStatusChange={jest.fn()}
        onAddComment={jest.fn()}
      />,
    );

    expect(screen.queryByLabelText('Estado')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows status actions for administrators in page mode', () => {
    mockedUseAuth.mockReturnValue({ currentUser: { roles: ['TENANT_ADMIN'] } } as never);
    mockedUseAssignableTicketMembers.mockReturnValue({
      data: [
        {
          membershipId: 'membership-1',
          name: 'Operador Uno',
          email: 'operator@example.com',
        },
      ],
      isLoading: false,
    } as never);

    render(
      <TicketDetail
        tenantId="tenant-1"
        ticket={ticket}
        variant="page"
        onBack={jest.fn()}
        onStatusChange={jest.fn()}
        onAddComment={jest.fn()}
        onAssign={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /volver/i })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /volver/i })).toBeTruthy();
    expect(screen.getByLabelText('Estado')).toBeTruthy();
    expect(screen.getByText('Media')).toBeTruthy();
    expect(screen.getByLabelText('Responsable')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Responsable' })).toBeTruthy();
  });
});
