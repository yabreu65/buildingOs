/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useParams, useRouter } from 'next/navigation';
import NotificationsPage from './page';
import * as notificationsHook from '@/features/notifications/useNotifications';
import * as authHook from '@/features/auth/useAuthSession';

jest.mock('@/shared/components/ui', () => {
  const actual = jest.requireActual('@/shared/components/ui');
  return {
    ...actual,
    useToast: () => ({ toast: jest.fn() }),
  };
});

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
  useRouter: jest.fn(),
}));

jest.mock('@/features/notifications/useNotifications', () => ({
  useNotifications: jest.fn(),
}));

jest.mock('@/features/auth/useAuthSession', () => ({
  useAuthSession: jest.fn(),
}));

const mockedUseParams = jest.mocked(useParams);
const mockedUseRouter = jest.mocked(useRouter);
const mockedUseNotifications = jest.mocked(notificationsHook.useNotifications);
const mockedUseAuthSession = jest.mocked(authHook.useAuthSession);

describe('NotificationsPage', () => {
  const push = jest.fn();
  const fetch = jest.fn();
  const markAsRead = jest.fn().mockResolvedValue(undefined);
  const markAllAsRead = jest.fn().mockResolvedValue(undefined);
  const deleteNotification = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseParams.mockReturnValue({ tenantId: 'tenant-1' } as never);
    mockedUseRouter.mockReturnValue({ push, replace: jest.fn(), back: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() } as never);
    mockedUseAuthSession.mockReturnValue({
      activeTenantId: 'tenant-1',
      memberships: [{ tenantId: 'tenant-1', roles: ['TENANT_ADMIN'] }],
      user: { id: 'admin-1', email: 'admin@test.com', name: 'Admin' },
    } as never);
    mockedUseNotifications.mockReturnValue({
      notifications: [
        {
          id: 'n1',
          tenantId: 'tenant-1',
          userId: 'admin-1',
          type: 'TICKET_STATUS_CHANGED',
          title: 'Estado actualizado',
          body: 'Tu reclamo cambió de estado',
          data: { ticketId: 'ticket-1', buildingId: 'building-1' },
          deliveryMethods: ['IN_APP'],
          isRead: false,
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ],
      total: 1,
      unreadCount: 1,
      loading: false,
      error: null,
      fetch,
      markAsRead,
      markAllAsRead,
      deleteNotification,
    } as never);
  });

  it('opens a ticket notification through the canonical detail route', async () => {
    render(<NotificationsPage />);

    fireEvent.click(screen.getByRole('button', { name: /abrir/i }));

    await waitFor(() => {
      expect(markAsRead).toHaveBeenCalledWith('n1');
      expect(push).toHaveBeenCalledWith('/tenant-1/tickets/ticket-1');
    });
  });
});
