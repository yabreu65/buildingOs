/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as notificationsApi from '@/features/notifications/notifications.api';
import * as financeApi from '@/features/finance/services/finance.api';
import * as sessionModule from '@/features/auth/session.storage';
import { logout as sharedLogout } from '@/features/auth/login.actions';

let mockTenantData: Array<{ id: string; name: string; type: 'EDIFICIO_AUTOGESTION' }> = [];
const mockPush = jest.fn();
const mockReplace = jest.fn();
let currentSearch = '';
const mockUseRouter = jest.fn(() => ({ push: mockPush, replace: mockReplace }));
const mockUseParams = jest.fn(() => ({ tenantId: 'tenant-1' }));
const mockUsePathname = jest.fn(() => '/tenant-1/dashboard');
const mockUseSearchParams = jest.fn(() => new URLSearchParams(currentSearch));

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
  getLastPortal: jest.fn(),
  setSession: jest.fn(),
  setLastTenant: jest.fn(),
  setLastPortal: jest.fn(),
  clearAuth: jest.fn(),
}));

jest.mock('@/features/impersonation/impersonation.storage', () => ({
  clearAllImpersonationData: jest.fn(),
}));

jest.mock('@/features/auth/login.actions', () => ({
  logout: jest.fn(),
}));

jest.mock('@/features/tenants/tenants.hooks', () => ({
  useTenants: () => ({ data: mockTenantData, isLoading: false, error: null }),
}));

jest.mock('@/features/notifications/components/PushPermissionControl', () => ({
  PushPermissionControl: () => null,
}));

jest.mock('next/navigation', () => ({
  useRouter: mockUseRouter,
  useParams: mockUseParams,
  usePathname: mockUsePathname,
  useSearchParams: mockUseSearchParams,
}));

const mockGetUnreadCount = jest.mocked(notificationsApi.getUnreadCount);
const mockListNotifications = jest.mocked(notificationsApi.listNotifications);
const mockMarkAsRead = jest.mocked(notificationsApi.markAsRead);
const mockMarkAllAsRead = jest.mocked(notificationsApi.markAllAsRead);
const mockListPendingPayments = jest.mocked(financeApi.listPendingPayments);
const mockGetSession = jest.mocked(sessionModule.getSession);
const mockGetLastPortal = jest.mocked(sessionModule.getLastPortal);
const mockSetSession = jest.mocked(sessionModule.setSession);
const mockSetLastTenant = jest.mocked(sessionModule.setLastTenant);
const mockSetLastPortal = jest.mocked(sessionModule.setLastPortal);
const mockedSharedLogout = jest.mocked(sharedLogout);

const TENANT_ID = 'tenant-1';

let PaymentNotificationBell: React.ComponentType<{ tenantId: string; currentSearch: string }>;
let Topbar: React.ComponentType<{
  isMobileMenuOpen?: boolean;
  menuButtonRef?: React.RefObject<HTMLButtonElement | null>;
  onMobileMenuToggle?: () => void;
}>;

beforeAll(async () => {
  const mod = await import('@/shared/components/layout/Topbar');
  PaymentNotificationBell = mod.PaymentNotificationBell;
  Topbar = mod.default;
});

beforeEach(() => {
  mockUseRouter.mockImplementation(() => ({ push: mockPush, replace: mockReplace }));
  mockUseParams.mockImplementation(() => ({ tenantId: 'tenant-1' }));
  mockUsePathname.mockImplementation(() => '/tenant-1/dashboard');
  mockUseSearchParams.mockImplementation(() => new URLSearchParams(currentSearch));
});

function renderBell(tenantId = TENANT_ID) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <PaymentNotificationBell tenantId={tenantId} currentSearch={currentSearch} />
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

function renderTopbar() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Topbar />
    </QueryClientProvider>,
  );
}

describe('PaymentNotificationBell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockReset();
    mockReplace.mockReset();
    mockedSharedLogout.mockReset();
    currentSearch = '';
    mockUseSearchParams.mockImplementation(() => new URLSearchParams(currentSearch) as never);
    mockGetSession.mockReturnValue({
      user: { id: 'user-1', email: 'test@test.com', name: 'Test User' },
      memberships: [{ tenantId: TENANT_ID, roles: ['RESIDENT'] }],
      activeTenantId: TENANT_ID,
    });
    mockGetLastPortal.mockReturnValue(null);
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

  it('calls the shared logout helper and redirects after it completes', async () => {
    mockGetSession.mockReturnValue({
      user: { id: 'user-1', email: 'test@test.com', name: 'Test User' },
      memberships: [{ tenantId: TENANT_ID, roles: ['RESIDENT'] }],
      activeTenantId: TENANT_ID,
    });
    let resolveLogout!: () => void;
    const logoutPromise = new Promise<void>((resolve) => {
      resolveLogout = resolve;
    });
    mockedSharedLogout.mockReturnValue(logoutPromise);

    renderTopbar();

    fireEvent.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    expect(mockedSharedLogout).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /saliendo/i })).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: /saliendo/i }));
    expect(mockedSharedLogout).toHaveBeenCalledTimes(1);

    resolveLogout();

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/login');
    });
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
          data: { buildingId: 'building-1', ticketId: 'ticket-1' },
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
      expect(mockPush).toHaveBeenCalledWith('/tenant-1/tickets/ticket-1?portal=resident');
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

  it('invalidates the notification scope after marking all as read', async () => {
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
      expect(mockMarkAllAsRead).toHaveBeenCalledWith(TENANT_ID);
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

  it('uses unreadCount only for the badge when pending payments also exist', async () => {
    mockGetSession.mockReturnValue({
      user: { id: 'admin-1', email: 'admin@test.com', name: 'Admin User' },
      memberships: [{ tenantId: TENANT_ID, roles: ['TENANT_ADMIN'] }],
      activeTenantId: TENANT_ID,
    });
    mockGetUnreadCount.mockResolvedValue(1);
    mockListPendingPayments.mockResolvedValue([
      { id: 'p1', status: 'SUBMITTED' },
    ] as Awaited<ReturnType<typeof financeApi.listPendingPayments>>);

    renderBell();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /notificaciones, 1 sin leer/i })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /notificaciones, 2 sin leer/i })).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /notificaciones, 1 sin leer/i }));

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

  it('resident sees DOCUMENT_SHARED notification in dropdown', async () => {
    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n-doc',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'DOCUMENT_SHARED',
          title: 'Documento compartido',
          body: 'Te compartieron un documento',
          data: {},
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
      expect(screen.getByText('Documento compartido')).toBeTruthy();
    });
  });

  it('resident sees OCCUPANT_ASSIGNED notification in dropdown', async () => {
    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n-occ',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'OCCUPANT_ASSIGNED',
          title: 'Asignado a unidad',
          body: 'Fuiste asignado a una unidad',
          data: {},
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
      expect(screen.getByText('Asignado a unidad')).toBeTruthy();
    });
  });

  it('resident sees CHARGE_PUBLISHED notification in dropdown', async () => {
    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n-charge',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'CHARGE_PUBLISHED',
          title: 'Nuevo cargo',
          body: 'Se publicó un cargo',
          data: {},
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
      expect(screen.getByText('Nuevo cargo')).toBeTruthy();
    });
  });

  it('resident sees PAYMENT_REMINDER notification in dropdown', async () => {
    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n-remind',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'PAYMENT_REMINDER',
          title: 'Recordatorio de pago',
          body: 'Tu pago vence pronto',
          data: {},
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
      expect(screen.getByText('Recordatorio de pago')).toBeTruthy();
    });
  });

  it('resident sees PAYMENT_OVERDUE notification in dropdown', async () => {
    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n-overdue',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'PAYMENT_OVERDUE',
          title: 'Pago vencido',
          body: 'Tu pago está vencido',
          data: {},
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
      expect(screen.getByText('Pago vencido')).toBeTruthy();
    });
  });

  it('resident sees SUPPORT_TICKET_STATUS_CHANGED when they are the recipient', async () => {
    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n-support',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'SUPPORT_TICKET_STATUS_CHANGED',
          title: 'Estado de solicitud',
          body: 'Tu solicitud fue actualizada',
          data: {},
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
      expect(screen.getByText('Estado de solicitud')).toBeTruthy();
    });
  });

  it('unknown notification type remains visible in dropdown', async () => {
    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n-unknown',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'CUSTOM_EVENT',
          title: 'Evento custom',
          body: 'Algo nuevo',
          data: {},
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
      expect(screen.getByText('Evento custom')).toBeTruthy();
    });
  });

  it('unknown notification type without valid route does not navigate to payments', async () => {
    const mockPush = jest.fn();
    jest.requireMock('next/navigation').useRouter = () => ({ push: mockPush, replace: jest.fn() });

    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n-unknown',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'CUSTOM_EVENT',
          title: 'Evento custom',
          body: 'Algo nuevo',
          data: {},
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
      expect(screen.getByText('Evento custom')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Evento custom'));

    await waitFor(() => {
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  it('badge preserves backend unreadCount without recalculation', async () => {
    mockGetUnreadCount.mockResolvedValue(5);
    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n1',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'DOCUMENT_SHARED',
          title: 'Doc',
          body: 'Body',
          data: {},
          deliveryMethods: ['IN_APP'],
          isRead: false,
          createdAt: '2025-01-15T10:00:00Z',
        },
        {
          id: 'n2',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'CUSTOM_TYPE',
          title: 'Custom',
          body: 'Body',
          data: {},
          deliveryMethods: ['IN_APP'],
          isRead: false,
          createdAt: '2025-01-15T10:00:00Z',
        },
      ],
      total: 2,
    });

    renderBell();

    await waitFor(() => {
      expect(screen.getByText('5')).toBeTruthy();
    });
  });

  it('opens the notification center preserving the resident portal context', async () => {
    const mockPush = jest.fn();
    jest.requireMock('next/navigation').useRouter = () => ({ push: mockPush, replace: jest.fn() });
    jest.requireMock('next/navigation').usePathname = () => '/tenant-1/resident/dashboard';

    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n-center',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'TICKET_COMMENT_ADDED',
          title: 'Comentario nuevo',
          body: 'Hay una actualización',
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
      expect(screen.getByText('Comentario nuevo')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /ver notificaciones/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/tenant-1/notifications?portal=resident');
    });
  });

  it('keeps the resident portal context on neutral routes when it was persisted', async () => {
    const mockPush = jest.fn();
    jest.requireMock('next/navigation').useRouter = () => ({ push: mockPush, replace: jest.fn() });
    jest.requireMock('next/navigation').usePathname = () => '/tenant-1/notifications';
    mockGetLastPortal.mockReturnValue('resident');

    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n-neutral',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'TICKET_COMMENT_ADDED',
          title: 'Comentario neutral',
          body: 'Hay una actualización',
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
      expect(screen.getByText('Comentario neutral')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /ver notificaciones/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/tenant-1/notifications?portal=resident');
    });
  });

  it('markAsRead invalidates both notification queries', async () => {
    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n1',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'TICKET_STATUS_CHANGED',
          title: 'Ticket update',
          body: 'Body',
          data: { ticketId: 't-1' },
          deliveryMethods: ['IN_APP'],
          isRead: false,
          createdAt: '2025-01-15T10:00:00Z',
        },
      ],
      total: 1,
    });

    const { queryClient } = renderBell();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    fireEvent.click(screen.getByRole('button', { name: /notificaciones/i }));

    await waitFor(() => {
      expect(screen.getByText('Ticket update')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Ticket update'));

    await waitFor(() => {
      expect(mockMarkAsRead).toHaveBeenCalledWith(TENANT_ID, 'n1');
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['notifications', TENANT_ID, 'user-1'] })
      );
    });

    invalidateSpy.mockRestore();
  });

  it('markAllAsRead invalidates both notification queries', async () => {
    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n1',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'TICKET_COMMENT_ADDED',
          title: 'Test',
          body: 'Body',
          data: {},
          deliveryMethods: ['IN_APP'],
          isRead: false,
          createdAt: '2025-01-15T10:00:00Z',
        },
      ],
      total: 1,
    });

    const { queryClient } = renderBell();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    fireEvent.click(screen.getByRole('button', { name: /notificaciones/i }));

    await waitFor(() => {
      expect(screen.getByText('Test')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Marcar todas como leídas'));

    await waitFor(() => {
      expect(mockMarkAllAsRead).toHaveBeenCalledWith(TENANT_ID);
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['notifications', TENANT_ID, 'user-1'] })
      );
    });

    invalidateSpy.mockRestore();
  });

  it('SUPPORT_TICKET_STATUS_CHANGED navigates to support page', async () => {
    const mockPush = jest.fn();
    jest.requireMock('next/navigation').useRouter = () => ({ push: mockPush, replace: jest.fn() });

    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n-support',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'SUPPORT_TICKET_STATUS_CHANGED',
          title: 'Estado de solicitud',
          body: 'Tu solicitud fue actualizada',
          data: { ticketId: 'support-42' },
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
      expect(screen.getByText('Estado de solicitud')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Estado de solicitud'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/tenant-1/support');
    });
  });

  it('SUPPORT_TICKET_CREATED with ticketId appears in the admin dropdown and opens the ticket detail', async () => {
    const mockPush = jest.fn();
    jest.requireMock('next/navigation').useRouter = () => ({ push: mockPush, replace: jest.fn() });

    mockGetSession.mockReturnValue({
      user: { id: 'admin-1', email: 'admin@test.com', name: 'Admin User' },
      memberships: [{ tenantId: TENANT_ID, roles: ['TENANT_ADMIN'] }],
      activeTenantId: TENANT_ID,
    });
    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n-support-created',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'SUPPORT_TICKET_CREATED',
          title: 'Nuevo reclamo',
          body: 'Se creó un reclamo de edificio',
          data: { ticketId: 'ticket-42', buildingId: 'building-1' },
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
      expect(screen.getByText('Nuevo reclamo')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Nuevo reclamo'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/tenant-1/tickets/ticket-42');
    });
  });

  it('mixed role user in resident portal navigates to resident payment route', async () => {
    const mockPush = jest.fn();
    jest.requireMock('next/navigation').useRouter = () => ({ push: mockPush, replace: jest.fn() });
    jest.requireMock('next/navigation').usePathname = () => '/tenant-1/resident/dashboard';

    mockGetSession.mockReturnValue({
      user: { id: 'admin-1', email: 'admin@test.com', name: 'Admin User' },
      memberships: [{ tenantId: TENANT_ID, roles: ['RESIDENT', 'TENANT_ADMIN'] }],
      activeTenantId: TENANT_ID,
    });

    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n-payment',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'PAYMENT_RECEIVED',
          title: 'Pago recibido',
          body: 'Tu pago fue procesado',
          data: { paymentId: 'pay-1' },
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
      expect(screen.getByText('Pago recibido')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Pago recibido'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/tenant-1/resident/payments');
    });
  });

  it('mixed role user in admin portal navigates to admin payment route', async () => {
    const mockPush = jest.fn();
    jest.requireMock('next/navigation').useRouter = () => ({ push: mockPush, replace: jest.fn() });
    jest.requireMock('next/navigation').usePathname = () => '/tenant-1/dashboard';

    mockGetSession.mockReturnValue({
      user: { id: 'admin-1', email: 'admin@test.com', name: 'Admin User' },
      memberships: [{ tenantId: TENANT_ID, roles: ['RESIDENT', 'TENANT_ADMIN'] }],
      activeTenantId: TENANT_ID,
    });

    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n-payment',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'PAYMENT_RECEIVED',
          title: 'Pago recibido',
          body: 'Tu pago fue procesado',
          data: { paymentId: 'pay-1' },
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
      expect(screen.getByText('Pago recibido')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Pago recibido'));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/tenant-1/finanzas?tab=payments');
    });
  });

  it('mixed role admin portal shows PAYMENT_REMINDER in the dropdown without hiding counted alerts', async () => {
    mockGetSession.mockReturnValue({
      user: { id: 'admin-1', email: 'admin@test.com', name: 'Admin User' },
      memberships: [{ tenantId: TENANT_ID, roles: ['RESIDENT', 'TENANT_ADMIN'] }],
      activeTenantId: TENANT_ID,
    });
    mockListNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n-reminder',
          tenantId: TENANT_ID,
          userId: 'user-1',
          type: 'PAYMENT_REMINDER',
          title: 'Recordatorio de pago',
          body: 'Tu pago vence pronto',
          data: {},
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
      expect(screen.getByText('Recordatorio de pago')).toBeTruthy();
    });
  });
});


describe("Topbar mobile menu trigger", () => {
  it("exposes the mobile navigation trigger with its expanded state", () => {
    const toggle = jest.fn();
    const buttonRef = { current: null } as React.RefObject<HTMLButtonElement | null>;

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <Topbar isMobileMenuOpen={false} menuButtonRef={buttonRef} onMobileMenuToggle={toggle} />
      </QueryClientProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Abrir menú de navegación" });
    expect(trigger.getAttribute("aria-controls")).toBe("mobile-navigation");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});

describe('PaymentNotificationBell responsive dropdown', () => {
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
  });

  it('keeps the mobile dropdown inside the viewport and restores focus after closing', async () => {
    renderBell();
    const trigger = screen.getByRole('button', { name: /notificaciones/i });

    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeTruthy();
    });

    const dropdown = screen.getByRole('menu');
    expect(dropdown.className).toContain('fixed');
    expect(dropdown.className).toContain('inset-x-2');
    expect(dropdown.className).toContain('max-h-[calc(100dvh-env(safe-area-inset-top)-4.5rem)]');
    expect(dropdown.className).toContain('lg:absolute');

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar notificaciones' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});


describe('Topbar responsive tenant selector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTenantData = [];
    currentSearch = '';
    jest.requireMock('next/navigation').useRouter = () => ({ push: jest.fn(), replace: jest.fn() });
  });

  it('renders distinct mobile and desktop selectors for multiple tenant memberships', () => {
    const longTenantName = 'Complejo Residencial con una denominación extensa que debe permanecer contenida';
    mockTenantData = [
      { id: 'tenant-1', name: longTenantName, type: 'EDIFICIO_AUTOGESTION' },
      { id: 'tenant-2', name: 'Edificio B', type: 'EDIFICIO_AUTOGESTION' },
    ];
    mockGetSession.mockReturnValue({
      user: { id: 'user-1', email: 'test@test.com', name: 'Test User' },
      memberships: [
        { tenantId: 'tenant-1', roles: ['RESIDENT'] },
        { tenantId: 'tenant-2', roles: ['RESIDENT'] },
      ],
      activeTenantId: 'tenant-1',
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><Topbar /></QueryClientProvider>);

    const mobileSelect = document.getElementById('tenant-select-mobile') as HTMLSelectElement;
    const desktopSelect = document.getElementById('tenant-select-desktop') as HTMLSelectElement;

    expect(mobileSelect).toBeTruthy();
    expect(desktopSelect).toBeTruthy();
    expect(mobileSelect.className).toContain('min-h-11');
    expect(mobileSelect.className).toContain('min-w-0');
    expect(mobileSelect.parentElement?.className).toContain('lg:hidden');
    expect(desktopSelect.parentElement?.className).toContain('hidden');
    expect(desktopSelect.parentElement?.className).toContain('lg:flex');
    expect(mobileSelect.id).not.toBe(desktopSelect.id);
    expect(mobileSelect.className).toContain('flex-1');
    expect(mobileSelect.options[0]?.text).toBe(longTenantName);
  });

  it('uses the existing tenant change logic from the mobile selector', async () => {
    const replace = jest.fn();
    jest.requireMock('next/navigation').useRouter = () => ({ push: jest.fn(), replace });
    const session: NonNullable<ReturnType<typeof sessionModule.getSession>> = {
      user: { id: 'user-1', email: 'test@test.com', name: 'Test User' },
      memberships: [
        { tenantId: 'tenant-1', roles: ['RESIDENT'] },
        { tenantId: 'tenant-2', roles: ['RESIDENT'] },
      ],
      activeTenantId: 'tenant-1',
    };
    mockGetSession.mockReturnValue(session);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><Topbar /></QueryClientProvider>);

    fireEvent.change(document.getElementById('tenant-select-mobile') as HTMLSelectElement, {
      target: { value: 'tenant-2' },
    });

    await waitFor(() => {
      expect(mockSetSession).toHaveBeenCalledWith({ ...session, activeTenantId: 'tenant-2' });
      expect(mockSetLastTenant).toHaveBeenCalledWith('tenant-2');
      expect(replace).toHaveBeenCalledWith('/tenant-2/resident/dashboard');
    });
  });

  it('does not render either selector for a single tenant membership', () => {
    mockGetSession.mockReturnValue({
      user: { id: 'user-1', email: 'test@test.com', name: 'Test User' },
      memberships: [{ tenantId: 'tenant-1', roles: ['RESIDENT'] }],
      activeTenantId: 'tenant-1',
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><Topbar /></QueryClientProvider>);

    expect(document.getElementById('tenant-select-mobile')).toBeNull();
    expect(document.getElementById('tenant-select-desktop')).toBeNull();
  });
});

describe('Topbar portal persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTenantData = [];
    currentSearch = '';
    mockGetSession.mockReturnValue({
      user: { id: 'user-1', email: 'test@test.com', name: 'Test User' },
      memberships: [
        { tenantId: 'tenant-1', roles: ['RESIDENT', 'TENANT_ADMIN'] },
      ],
      activeTenantId: 'tenant-1',
    });
  });

  it('persists the resident portal when the active route is resident', async () => {
    jest.requireMock('next/navigation').usePathname = () => '/tenant-1/resident/dashboard';

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <Topbar />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(mockSetLastPortal).toHaveBeenCalledWith('resident');
    });
  });

  it('persists the admin portal when the active route is administrative', async () => {
    jest.requireMock('next/navigation').usePathname = () => '/tenant-1/dashboard';

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <Topbar />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(mockSetLastPortal).toHaveBeenCalledWith('admin');
    });
  });
});


function MobileMenuHarness() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <Topbar
      isMobileMenuOpen={isMobileMenuOpen}
      onMobileMenuToggle={() => setIsMobileMenuOpen((open) => !open)}
    />
  );
}

describe('PaymentNotificationBell drawer coordination', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTenantData = [];
    currentSearch = '';
    mockGetSession.mockReturnValue({
      user: { id: 'user-1', email: 'test@test.com', name: 'Test User' },
      memberships: [{ tenantId: TENANT_ID, roles: ['RESIDENT'] }],
      activeTenantId: TENANT_ID,
    });
    mockGetUnreadCount.mockResolvedValue(0);
    mockListNotifications.mockResolvedValue({ notifications: [], total: 0 });
    mockListPendingPayments.mockResolvedValue([]);
    jest.requireMock('next/navigation').useRouter = () => ({ push: jest.fn(), replace: jest.fn() });
  });

  it('closes an open notification dropdown when mobile-menu state changes programmatically', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <Topbar isMobileMenuOpen={false} />
      </QueryClientProvider>,
    );
    const notificationButton = screen.getByRole('button', { name: /notificaciones/i });

    fireEvent.click(notificationButton);
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());

    rerender(
      <QueryClientProvider client={queryClient}>
        <Topbar isMobileMenuOpen />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
      expect(notificationButton.getAttribute('aria-expanded')).toBe('false');
    });

    rerender(
      <QueryClientProvider client={queryClient}>
        <Topbar isMobileMenuOpen={false} />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(notificationButton);
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
  });

  it('closes notifications through the hamburger interaction without requiring mousedown', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MobileMenuHarness />
      </QueryClientProvider>,
    );

    const notificationButton = screen.getByRole('button', { name: /notificaciones/i });
    fireEvent.click(notificationButton);
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú de navegación' }));

    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
      expect(notificationButton.getAttribute('aria-expanded')).toBe('false');
    });
  });
});
