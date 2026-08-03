/**
 * @jest-environment jsdom
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import AppShell from './AppShell';
import type { AuthSession, Role } from '@/features/auth/auth.types';
import * as notificationsApi from '@/features/notifications/notifications.api';
import * as pushSubscriptionApi from '@/features/notifications/push-subscription.api';
import * as financeApi from '@/features/finance/services/finance.api';
import * as sessionModule from '@/features/auth/session.storage';

let mockTenantData: Array<{ id: string; name: string; type: 'EDIFICIO_AUTOGESTION' }> = [];
let mockTenantId = 'tenant-1';
let mockPathname = '/tenant-1/dashboard';
let mockSearchParams = '';
let mockAuthSession: AuthSession = {
  user: { id: 'user-1', email: 'test@test.com', name: 'Test User' },
  memberships: [{ tenantId: 'tenant-1', roles: ['RESIDENT' as Role] }],
  activeTenantId: 'tenant-1',
};

jest.mock('next/navigation', () => ({
  useParams: () => ({ tenantId: mockTenantId }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(mockSearchParams),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('@/features/tenants/tenants.hooks', () => ({
  useTenants: () => ({ data: mockTenantData, isLoading: false, error: null }),
}));

jest.mock('@/features/auth/useAuthSession', () => ({
  useAuthSession: () => mockAuthSession,
  useIsSuperAdmin: () => false,
  useHasRole: (role: string) => role === 'RESIDENT',
}));

jest.mock('@/features/impersonation/useImpersonation', () => ({
  useImpersonation: () => ({ isImpersonating: false }),
}));

jest.mock('@/features/impersonation/ImpersonationBanner', () => ({
  ImpersonationBanner: () => null,
}));

jest.mock('@/shared/components/assistant', () => ({
  AssistantWidget: () => <div data-testid="assistant-widget" data-open="false" />,
  useAssistantContext: () => ({}),
}));

jest.mock('./Sidebar', () => ({
  __esModule: true,
  default: ({ id, footer }: { id?: string; footer?: ReactNode }) => (
    <aside id={id} data-testid="sidebar-shell">
      {footer}
    </aside>
  ),
}));

jest.mock('@/features/notifications/notifications.api', () => ({
  listNotifications: jest.fn(),
  getUnreadCount: jest.fn(),
  markAsRead: jest.fn(),
  markAllAsRead: jest.fn(),
  deleteNotification: jest.fn(),
}));

jest.mock('@/features/notifications/push-subscription.api', () => ({
  getExistingPushSubscription: jest.fn(),
  getVapidPublicKey: jest.fn(),
  isWebPushSupported: jest.fn(),
  subscribeToWebPush: jest.fn(),
  unsubscribeFromWebPush: jest.fn(),
  PushSubscriptionError: class PushSubscriptionError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
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

const mockGetUnreadCount = jest.mocked(notificationsApi.getUnreadCount);
const mockListNotifications = jest.mocked(notificationsApi.listNotifications);
const mockMarkAsRead = jest.mocked(notificationsApi.markAsRead);
const mockGetExistingPushSubscription = jest.mocked(pushSubscriptionApi.getExistingPushSubscription);
const mockGetVapidPublicKey = jest.mocked(pushSubscriptionApi.getVapidPublicKey);
const mockIsWebPushSupported = jest.mocked(pushSubscriptionApi.isWebPushSupported);
const mockSubscribeToWebPush = jest.mocked(pushSubscriptionApi.subscribeToWebPush);
const mockUnsubscribeFromWebPush = jest.mocked(pushSubscriptionApi.unsubscribeFromWebPush);
const mockListPendingPayments = jest.mocked(financeApi.listPendingPayments);
const mockGetSession = jest.mocked(sessionModule.getSession);

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <AppShell>Contenido</AppShell>
      </QueryClientProvider>,
    ),
  };
}

describe('AppShell push permission integration', () => {
  beforeEach(() => {
    mockTenantData = [{ id: 'tenant-1', name: 'Tenant 1', type: 'EDIFICIO_AUTOGESTION' }];
    mockTenantId = 'tenant-1';
    mockPathname = '/tenant-1/dashboard';
    mockSearchParams = '';
    mockAuthSession = {
      user: { id: 'user-1', email: 'test@test.com', name: 'Test User' },
      memberships: [{ tenantId: 'tenant-1', roles: ['RESIDENT' as Role] }],
      activeTenantId: 'tenant-1',
    };
    jest.clearAllMocks();

    mockGetSession.mockReturnValue(mockAuthSession);
    mockGetUnreadCount.mockResolvedValue(0);
    mockListNotifications.mockResolvedValue({ notifications: [], total: 0 });
    mockListPendingPayments.mockResolvedValue([]);
    mockMarkAsRead.mockResolvedValue({ id: 'n1', isRead: true } as Awaited<ReturnType<typeof notificationsApi.markAsRead>>);
    mockIsWebPushSupported.mockReturnValue(true);
    mockGetVapidPublicKey.mockReturnValue('public-key');
    mockGetExistingPushSubscription.mockResolvedValue(null);
    mockSubscribeToWebPush.mockResolvedValue({
      endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
      subscription: {} as PushSubscription,
    });
    mockUnsubscribeFromWebPush.mockResolvedValue({
      endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-1',
      unsubscribed: true,
    });
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: jest.fn(),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'Notification');
  });

  it('shares one push state across the desktop and drawer presentations inside AppShell', async () => {
    renderShell();

    await waitFor(() => {
      expect(mockGetUnreadCount).toHaveBeenCalledTimes(1);
      expect(mockGetExistingPushSubscription).toHaveBeenCalledTimes(1);
    });

    const desktopControl = screen.getByRole('button', { name: 'Activar alertas' });
    fireEvent.click(desktopControl);

    await waitFor(() => {
      expect(mockSubscribeToWebPush).toHaveBeenCalledTimes(1);
      expect(screen.getAllByRole('button', { name: 'Desactivar alertas' })).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú de navegación' }));
    const drawer = screen.getByRole('dialog', { name: 'Navegación principal' });
    const drawerControl = within(drawer).getByRole('button', { name: 'Desactivar alertas' });
    expect(drawerControl).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Desactivar alertas' })).toHaveLength(2);

    fireEvent.click(drawerControl);

    await waitFor(() => {
      expect(mockUnsubscribeFromWebPush).toHaveBeenCalledTimes(1);
      expect(screen.getAllByRole('button', { name: 'Activar alertas' })).toHaveLength(2);
    });
  });

  it('reinitializes the shared push controller when the tenant changes', async () => {
    const { rerender, queryClient } = renderShell();

    await waitFor(() => {
      expect(mockGetUnreadCount).toHaveBeenCalledTimes(1);
    });

    const desktopControl = screen.getByRole('button', { name: 'Activar alertas' });
    await waitFor(() => {
      expect(desktopControl).toHaveProperty('disabled', false);
    });
    fireEvent.click(desktopControl);

    await waitFor(() => {
      expect(mockSubscribeToWebPush).toHaveBeenCalledTimes(1);
      expect(mockSubscribeToWebPush).toHaveBeenCalledWith('tenant-1');
      expect(screen.getByRole('button', { name: 'Desactivar alertas' })).toBeTruthy();
    });

    mockSubscribeToWebPush.mockClear();
    mockGetExistingPushSubscription.mockClear();

    mockTenantId = 'tenant-2';
    mockTenantData = [{ id: 'tenant-2', name: 'Tenant 2', type: 'EDIFICIO_AUTOGESTION' }];
    mockGetSession.mockReturnValue({
      user: { id: 'user-1', email: 'test@test.com', name: 'Test User' },
      memberships: [{ tenantId: 'tenant-2', roles: ['RESIDENT'] }],
      activeTenantId: 'tenant-2',
    });

    rerender(
      <QueryClientProvider client={queryClient}>
        <AppShell>Contenido</AppShell>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(mockGetUnreadCount).toHaveBeenCalledTimes(2);
      expect(mockGetExistingPushSubscription).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Activar alertas' })).toBeTruthy();
    });
  });

  it('keeps the tenant push state when the drawer is closed and reopened', async () => {
    renderShell();

    await waitFor(() => {
      expect(mockGetUnreadCount).toHaveBeenCalledTimes(1);
      expect(mockGetExistingPushSubscription).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú de navegación' }));
    const drawer = screen.getByRole('dialog', { name: 'Navegación principal' });
    await waitFor(() => {
      expect(within(drawer).getByRole('button', { name: 'Activar alertas' })).toHaveProperty('disabled', false);
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Activar alertas' }));

    await waitFor(() => {
      expect(mockSubscribeToWebPush).toHaveBeenCalledTimes(1);
      expect(mockSubscribeToWebPush).toHaveBeenCalledWith('tenant-1');
      expect(within(drawer).getByRole('button', { name: 'Desactivar alertas' })).toBeTruthy();
    });

    mockSubscribeToWebPush.mockClear();
    mockGetExistingPushSubscription.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar menú' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú de navegación' }));

    const reopenedDrawer = screen.getByRole('dialog', { name: 'Navegación principal' });
    expect(within(reopenedDrawer).getByRole('button', { name: 'Desactivar alertas' })).toBeTruthy();
    expect(mockSubscribeToWebPush).toHaveBeenCalledTimes(0);
    expect(mockGetExistingPushSubscription).toHaveBeenCalledTimes(0);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar menú' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú de navegación' }));

    const reopenedAgainDrawer = screen.getByRole('dialog', { name: 'Navegación principal' });
    expect(within(reopenedAgainDrawer).getByRole('button', { name: 'Desactivar alertas' })).toBeTruthy();
    expect(mockSubscribeToWebPush).toHaveBeenCalledTimes(0);
    expect(mockGetExistingPushSubscription).toHaveBeenCalledTimes(0);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar menú' }));
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar alertas' }));

    await waitFor(() => {
      expect(mockUnsubscribeFromWebPush).toHaveBeenCalledTimes(1);
      expect(mockUnsubscribeFromWebPush).toHaveBeenCalledWith('tenant-1');
      expect(screen.getByRole('button', { name: 'Activar alertas' })).toHaveProperty('disabled', false);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú de navegación' }));
    const activateDrawer = screen.getByRole('dialog', { name: 'Navegación principal' });
    expect(within(activateDrawer).getByRole('button', { name: 'Activar alertas' })).toBeTruthy();
  });
});
