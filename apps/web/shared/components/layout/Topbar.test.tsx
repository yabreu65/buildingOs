/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as notificationsApi from '@/features/notifications/notifications.api';
import * as financeApi from '@/features/finance/services/finance.api';
import * as sessionModule from '@/features/auth/session.storage';

jest.mock('@/features/notifications/notifications.api', () => ({
  listNotifications: jest.fn(),
  getUnreadCount: jest.fn(),
  markAsRead: jest.fn(),
  markAllAsRead: jest.fn(),
  deleteNotification: jest.fn(),
}));

jest.mock('@/features/finance/services/finance.api', () => ({
  listPendingPayments: jest.fn(),
  PaymentStatus: { SUBMITTED: 'SUBMITTED' },
}));

jest.mock('@/features/auth/session.storage', () => ({
  getSession: jest.fn(),
  setSession: jest.fn(),
  setLastTenant: jest.fn(),
  clearAuth: jest.fn(),
}));

jest.mock('@/features/impersonation/impersonation.storage', () => ({
  clearAllImpersonationData: jest.fn(),
}));

jest.mock('@/features/tenants/tenants.hooks', () => ({
  useTenants: () => ({ data: [], isLoading: false, error: null }),
}));

jest.mock('@/features/notifications/components/PushPermissionControl', () => ({
  PushPermissionControl: () => null,
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useParams: () => ({ tenantId: 'tenant-1' }),
}));

const mockGetUnreadCount = jest.mocked(notificationsApi.getUnreadCount);
const mockListNotifications = jest.mocked(notificationsApi.listNotifications);
const mockMarkAsRead = jest.mocked(notificationsApi.markAsRead);
const mockMarkAllAsRead = jest.mocked(notificationsApi.markAllAsRead);
const mockListPendingPayments = jest.mocked(financeApi.listPendingPayments);
const mockGetSession = jest.mocked(sessionModule.getSession);

const TENANT_ID = 'tenant-1';

let PaymentNotificationBell: React.ComponentType<{ tenantId: string }>;

beforeAll(async () => {
  const mod = await import('@/shared/components/layout/Topbar');
  PaymentNotificationBell = mod.PaymentNotificationBell;
});

function renderBell(tenantId = TENANT_ID) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <PaymentNotificationBell tenantId={tenantId} />
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

describe('PaymentNotificationBell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockReturnValue({
      user: { id: 'user-1', email: 'test@test.com', name: 'Test User' },
      memberships: [{ tenantId: TENANT_ID, roles: ['RESIDENT'] }],
      activeTenantId: TENANT_ID,
    });
    mockGetUnreadCount.mockResolvedValue(0);
    mockListNotifications.mockResolvedValue({ notifications: [], total: 0 });
    mockListPendingPayments.mockResolvedValue([]);
    mockMarkAsRead.mockResolvedValue({ id: 'n1', isRead: true } as Awaited<ReturnType<typeof notificationsApi.markAsRead>>);
    mockMarkAllAsRead.mockResolvedValue({ success: true });
  });

  it('renders the bell button', () => {
    renderBell();
    expect(screen.getByRole('button', { name: /notificaciones/i })).toBeTruthy();
  });

  it('queries unread count with tenantId', async () => {
    renderBell();
    await waitFor(() => {
      expect(mockGetUnreadCount).toHaveBeenCalledWith(TENANT_ID);
    });
  });

  it('shows badge when there are unread notifications', async () => {
    mockGetUnreadCount.mockResolvedValue(3);
    renderBell();
    await waitFor(() => {
      expect(screen.getByText('3')).toBeTruthy();
    });
  });

  it('shows 9+ when unread count exceeds 9', async () => {
    mockGetUnreadCount.mockResolvedValue(15);
    renderBell();
    await waitFor(() => {
      expect(screen.getByText('9+')).toBeTruthy();
    });
  });

  it('does not show badge when count is 0', async () => {
    mockGetUnreadCount.mockResolvedValue(0);
    renderBell();
    await waitFor(() => {
      expect(mockGetUnreadCount).toHaveBeenCalled();
    });
    expect(screen.queryByText('0')).toBeNull();
  });

  it('opens dropdown on click and shows notifications', async () => {
    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n1',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'TICKET_COMMENT_ADDED',
          title: 'Nuevo comentario',
          body: 'Admin respondió tu reclamo',
          deliveryMethods: ['IN_APP'],
          isRead: false,
          createdAt: '2025-01-15T10:00:00Z',
        },
      ],
      total: 1,
    });

    renderBell();

    fireEvent.click(screen.getByRole('button', { name: /notificaciones/i }));

    await waitFor(() => {
      expect(mockListNotifications).toHaveBeenCalledWith(TENANT_ID, { take: 20 });
      expect(screen.getByText('Nuevo comentario')).toBeTruthy();
      expect(screen.getByText('Admin respondió tu reclamo')).toBeTruthy();
    });
  });

  it('shows loading state while fetching', async () => {
    mockListNotifications.mockReturnValue(new Promise(() => {}));
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: /notificaciones/i }));

    await waitFor(() => {
      expect(screen.getByText(/cargando notificaciones/i)).toBeTruthy();
    });
  });

  it('shows error state on failure', async () => {
    mockListNotifications.mockRejectedValue(new Error('Network error'));
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: /notificaciones/i }));

    await waitFor(() => {
      expect(screen.getByText(/no se pudieron cargar las notificaciones/i)).toBeTruthy();
    });
  });

  it('shows empty state when no notifications', async () => {
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: /notificaciones/i }));

    await waitFor(() => {
      expect(screen.getByText(/no hay notificaciones nuevas/i)).toBeTruthy();
    });
  });

  it('clicking a notification marks it as read with tenantId and navigates', async () => {
    const mockPush = jest.fn();
    jest.requireMock('next/navigation').useRouter = () => ({ push: mockPush, replace: jest.fn() });

    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n1',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'TICKET_STATUS_CHANGED',
          title: 'Estado actualizado',
          body: 'Tu reclamo cambió de estado',
          data: { buildingId: 'building-1' },
          deliveryMethods: ['IN_APP'],
          isRead: false,
          createdAt: '2025-01-15T10:00:00Z',
        },
      ],
      total: 1,
    });

    renderBell();
    fireEvent.click(screen.getByRole('button', { name: /notificaciones/i }));

    await waitFor(() => {
      expect(screen.getByText('Estado actualizado')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Estado actualizado'));

    await waitFor(() => {
      expect(mockMarkAsRead).toHaveBeenCalledWith(TENANT_ID, 'n1');
      expect(mockPush).toHaveBeenCalledWith('/tenant-1/resident/tickets');
    });
  });

  it('markAllAsRead calls single API endpoint with tenantId', async () => {
    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n1',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'TICKET_COMMENT_ADDED',
          title: 'Test',
          body: 'Test body',
          deliveryMethods: ['IN_APP'],
          isRead: false,
          createdAt: '2025-01-15T10:00:00Z',
        },
      ],
      total: 1,
    });

    renderBell();
    fireEvent.click(screen.getByRole('button', { name: /notificaciones/i }));

    await waitFor(() => {
      expect(screen.getByText('Test')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Marcar todas como leídas'));

    await waitFor(() => {
      expect(mockMarkAllAsRead).toHaveBeenCalledWith(TENANT_ID);
      expect(mockMarkAsRead).not.toHaveBeenCalled();
    });
  });

  it('badge updates after marking all as read', async () => {
    mockGetUnreadCount
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0);

    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n1',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'TICKET_COMMENT_ADDED',
          title: 'Test',
          body: 'Body',
          deliveryMethods: ['IN_APP'],
          isRead: false,
          createdAt: '2025-01-15T10:00:00Z',
        },
      ],
      total: 1,
    });

    renderBell();

    await waitFor(() => {
      expect(screen.getByText('2')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /notificaciones/i }));

    await waitFor(() => {
      expect(screen.getByText('Marcar todas como leídas')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Marcar todas como leídas'));

    await waitFor(() => {
      expect(screen.queryByText('2')).toBeNull();
    });
  });

  it('has correct accessibility attributes', () => {
    renderBell();
    const button = screen.getByRole('button', { name: /notificaciones/i });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe('notification-dropdown');
  });

  it('Escape closes the dropdown', async () => {
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: /notificaciones/i }));

    await waitFor(() => {
      expect(screen.getByText('Notificaciones')).toBeTruthy();
    });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByText('Marcar todas como leídas')).toBeNull();
    });
  });

  it('admin sees pending payments card when no notifications', async () => {
    mockGetSession.mockReturnValue({
      user: { id: 'admin-1', email: 'admin@test.com', name: 'Admin User' },
      memberships: [{ tenantId: TENANT_ID, roles: ['TENANT_ADMIN'] }],
      activeTenantId: TENANT_ID,
    });
    mockListPendingPayments.mockResolvedValue([
      { id: 'p1', status: 'SUBMITTED' },
    ] as Awaited<ReturnType<typeof financeApi.listPendingPayments>>);

    renderBell();
    fireEvent.click(screen.getByRole('button', { name: /notificaciones/i }));

    await waitFor(() => {
      expect(screen.getByText(/1 pago pendiente por revisar/)).toBeTruthy();
    });
  });

  it('recognizes an admin when the membership also includes RESIDENT', async () => {
    mockGetSession.mockReturnValue({
      user: { id: 'admin-1', email: 'admin@test.com', name: 'Admin User' },
      memberships: [{ tenantId: TENANT_ID, roles: ['RESIDENT', 'TENANT_ADMIN'] }],
      activeTenantId: TENANT_ID,
    });
    mockListPendingPayments.mockResolvedValue([
      { id: 'p1', status: 'SUBMITTED' },
    ] as Awaited<ReturnType<typeof financeApi.listPendingPayments>>);

    renderBell();
    fireEvent.click(screen.getByRole('button', { name: /notificaciones/i }));

    await waitFor(() => {
      expect(screen.getByText(/1 pago pendiente por revisar/)).toBeTruthy();
    });
  });
});
