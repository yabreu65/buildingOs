import { resolveNotificationPath, type NotificationRoleContext } from './notification-routes';
import type { Notification } from '@/features/notifications/notifications.api';

const TENANT_ID = 'tenant-1';

const adminContext: NotificationRoleContext = { isAdmin: true, isResident: false };
const residentContext: NotificationRoleContext = { isAdmin: false, isResident: true };
const mixedResidentPortal: NotificationRoleContext = { isAdmin: true, isResident: true, portalContext: 'resident' };
const mixedAdminPortal: NotificationRoleContext = { isAdmin: true, isResident: true, portalContext: 'admin' };

function makeNotification(overrides: Partial<Notification> & { type: string }): Notification {
  return {
    id: 'n1',
    tenantId: TENANT_ID,
    userId: 'user-1',
    title: 'Test',
    body: 'Body',
    data: {},
    deliveryMethods: ['IN_APP'],
    isRead: false,
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('resolveNotificationPath', () => {
  describe('ticket types', () => {
    it('resolves TICKET_STATUS_CHANGED with ticketId to detail path', () => {
      const n = makeNotification({
        type: 'TICKET_STATUS_CHANGED',
        data: { ticketId: 'ticket-42', buildingId: 'b-1' },
      });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBe(
        `/${TENANT_ID}/tickets/ticket-42`
      );
    });

    it('resolves TICKET_COMMENT_ADDED without ticketId to resident tickets list', () => {
      const n = makeNotification({ type: 'TICKET_COMMENT_ADDED', data: {} });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBe(
        `/${TENANT_ID}/resident/tickets`
      );
    });

    it('resolves SUPPORT_TICKET_STATUS_CHANGED to support page', () => {
      const n = makeNotification({ type: 'SUPPORT_TICKET_STATUS_CHANGED', data: {} });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBe(
        `/${TENANT_ID}/support`
      );
    });

    it('resolves ticket type without ticketId for admin to building tickets', () => {
      const n = makeNotification({
        type: 'TICKET_STATUS_CHANGED',
        data: { buildingId: 'b-1' },
      });
      expect(resolveNotificationPath(n, TENANT_ID, adminContext)).toBe(
        `/${TENANT_ID}/buildings/b-1/tickets`
      );
    });

    it('resolves ticket type without ticketId for admin without buildingId to tenant tickets', () => {
      const n = makeNotification({ type: 'TICKET_STATUS_CHANGED', data: {} });
      expect(resolveNotificationPath(n, TENANT_ID, adminContext)).toBe(
        `/${TENANT_ID}/tickets`
      );
    });

    it('does not treat unknown type with ticketId as ticket', () => {
      const n = makeNotification({
        type: 'SYSTEM_ALERT',
        data: { ticketId: 'ticket-42' },
      });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBeNull();
    });
  });

  describe('support ticket types', () => {
    it('resolves SUPPORT_TICKET_STATUS_CHANGED to support page regardless of ticketId', () => {
      const n = makeNotification({
        type: 'SUPPORT_TICKET_STATUS_CHANGED',
        data: { ticketId: 'support-42' },
      });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBe(
        `/${TENANT_ID}/support`
      );
    });

    it('resolves SUPPORT_TICKET_CREATED to support page', () => {
      const n = makeNotification({ type: 'SUPPORT_TICKET_CREATED', data: {} });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBe(
        `/${TENANT_ID}/support`
      );
    });

    it('resolves SUPPORT_TICKET_STATUS_CHANGED for admin to support page', () => {
      const n = makeNotification({ type: 'SUPPORT_TICKET_STATUS_CHANGED', data: {} });
      expect(resolveNotificationPath(n, TENANT_ID, adminContext)).toBe(
        `/${TENANT_ID}/support`
      );
    });

    it('does not use ticketDetailPath for support ticket types', () => {
      const n = makeNotification({
        type: 'SUPPORT_TICKET_STATUS_CHANGED',
        data: { ticketId: 'support-42', buildingId: 'b-1' },
      });
      const path = resolveNotificationPath(n, TENANT_ID, adminContext);
      expect(path).toBe(`/${TENANT_ID}/support`);
      expect(path).not.toContain('/tickets/');
    });
  });

  describe('payment types', () => {
    it.each([
      'PAYMENT_RECEIVED',
      'PAYMENT_REJECTED',
      'PAYMENT_REMINDER',
      'PAYMENT_OVERDUE',
      'CHARGE_PUBLISHED',
    ])('resolves %s for resident to resident/payments', (type) => {
      const n = makeNotification({ type, data: {} });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBe(
        `/${TENANT_ID}/resident/payments`
      );
    });

    it.each([
      'PAYMENT_RECEIVED',
      'PAYMENT_REJECTED',
      'PAYMENT_REMINDER',
      'PAYMENT_OVERDUE',
      'CHARGE_PUBLISHED',
    ])('resolves %s for admin to finanzas', (type) => {
      const n = makeNotification({ type, data: {} });
      expect(resolveNotificationPath(n, TENANT_ID, adminContext)).toBe(
        `/${TENANT_ID}/finanzas?tab=payments`
      );
    });
  });

  describe('document types', () => {
    it('resolves DOCUMENT_SHARED for resident to resident/documents', () => {
      const n = makeNotification({ type: 'DOCUMENT_SHARED', data: {} });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBe(
        `/${TENANT_ID}/resident/documents`
      );
    });

    it('resolves DOCUMENT_SHARED for admin with buildingId to building documents', () => {
      const n = makeNotification({
        type: 'DOCUMENT_SHARED',
        data: { buildingId: 'b-1' },
      });
      expect(resolveNotificationPath(n, TENANT_ID, adminContext)).toBe(
        `/${TENANT_ID}/buildings/b-1/documents`
      );
    });

    it('resolves DOCUMENT_SHARED for admin without buildingId to buildings list', () => {
      const n = makeNotification({ type: 'DOCUMENT_SHARED', data: {} });
      expect(resolveNotificationPath(n, TENANT_ID, adminContext)).toBe(
        `/${TENANT_ID}/buildings`
      );
    });
  });

  describe('unit types', () => {
    it('resolves OCCUPANT_ASSIGNED for resident to resident/unit', () => {
      const n = makeNotification({ type: 'OCCUPANT_ASSIGNED', data: {} });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBe(
        `/${TENANT_ID}/resident/unit`
      );
    });

    it('resolves OCCUPANT_ASSIGNED for admin with buildingId to building units', () => {
      const n = makeNotification({
        type: 'OCCUPANT_ASSIGNED',
        data: { buildingId: 'b-1' },
      });
      expect(resolveNotificationPath(n, TENANT_ID, adminContext)).toBe(
        `/${TENANT_ID}/buildings/b-1/units`
      );
    });

    it('resolves OCCUPANT_ASSIGNED for admin without buildingId to buildings list', () => {
      const n = makeNotification({ type: 'OCCUPANT_ASSIGNED', data: {} });
      expect(resolveNotificationPath(n, TENANT_ID, adminContext)).toBe(
        `/${TENANT_ID}/buildings`
      );
    });
  });

  describe('fallback URL validation', () => {
    it('accepts safe resident path as fallback', () => {
      const n = makeNotification({
        type: 'SYSTEM_ALERT',
        data: { url: `/${TENANT_ID}/resident/dashboard` },
      });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBe(
        `/${TENANT_ID}/resident/dashboard`
      );
    });

    it('rejects external protocol', () => {
      const n = makeNotification({
        type: 'SYSTEM_ALERT',
        data: { url: 'https://evil.com/phish' },
      });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBeNull();
    });

    it('rejects javascript: protocol', () => {
      const n = makeNotification({
        type: 'SYSTEM_ALERT',
        data: { url: 'javascript:alert(1)' },
      });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBeNull();
    });

    it('rejects data: protocol', () => {
      const n = makeNotification({
        type: 'SYSTEM_ALERT',
        data: { url: 'data:text/html,<script>alert(1)</script>' },
      });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBeNull();
    });

    it('rejects double slash', () => {
      const n = makeNotification({
        type: 'SYSTEM_ALERT',
        data: { url: '//evil.com' },
      });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBeNull();
    });

    it('rejects traversal', () => {
      const n = makeNotification({
        type: 'SYSTEM_ALERT',
        data: { url: `/${TENANT_ID}/resident/../admin` },
      });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBeNull();
    });

    it('rejects encoded traversal', () => {
      const n = makeNotification({
        type: 'SYSTEM_ALERT',
        data: { url: `/${TENANT_ID}/resident/%2e%2e/admin` },
      });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBeNull();
    });

    it('rejects backslash', () => {
      const n = makeNotification({
        type: 'SYSTEM_ALERT',
        data: { url: `/${TENANT_ID}\\admin` },
      });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBeNull();
    });

    it('rejects different tenant', () => {
      const n = makeNotification({
        type: 'SYSTEM_ALERT',
        data: { url: '/other-tenant/resident/dashboard' },
      });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBeNull();
    });

    it('rejects admin path for resident', () => {
      const n = makeNotification({
        type: 'SYSTEM_ALERT',
        data: { url: `/${TENANT_ID}/finanzas` },
      });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBeNull();
    });

    it('accepts safe admin path for admin', () => {
      const n = makeNotification({
        type: 'SYSTEM_ALERT',
        data: { url: `/${TENANT_ID}/inbox` },
      });
      expect(resolveNotificationPath(n, TENANT_ID, adminContext)).toBe(
        `/${TENANT_ID}/inbox`
      );
    });

    it('rejects admin-only paths for admin (finanzas is already handled by payment types)', () => {
      const n = makeNotification({
        type: 'SYSTEM_ALERT',
        data: { url: `/${TENANT_ID}/super-admin` },
      });
      expect(resolveNotificationPath(n, TENANT_ID, adminContext)).toBeNull();
    });

    it('returns null for non-string url', () => {
      const n = makeNotification({
        type: 'SYSTEM_ALERT',
        data: { url: 123 as unknown as string },
      });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBeNull();
    });

    it('returns null for non-slash url', () => {
      const n = makeNotification({
        type: 'SYSTEM_ALERT',
        data: { url: 'relative-path' },
      });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBeNull();
    });

    it('returns null for unknown type without valid fallback', () => {
      const n = makeNotification({ type: 'UNKNOWN_TYPE', data: {} });
      expect(resolveNotificationPath(n, TENANT_ID, residentContext)).toBeNull();
    });
  });

  describe('portalContext for mixed roles', () => {
    it('resolves payment to resident path when portalContext is resident', () => {
      const n = makeNotification({ type: 'PAYMENT_RECEIVED', data: {} });
      expect(resolveNotificationPath(n, TENANT_ID, mixedResidentPortal)).toBe(
        `/${TENANT_ID}/resident/payments`
      );
    });

    it('resolves payment to admin path when portalContext is admin', () => {
      const n = makeNotification({ type: 'PAYMENT_RECEIVED', data: {} });
      expect(resolveNotificationPath(n, TENANT_ID, mixedAdminPortal)).toBe(
        `/${TENANT_ID}/finanzas?tab=payments`
      );
    });

    it('resolves document to resident path when portalContext is resident', () => {
      const n = makeNotification({ type: 'DOCUMENT_SHARED', data: {} });
      expect(resolveNotificationPath(n, TENANT_ID, mixedResidentPortal)).toBe(
        `/${TENANT_ID}/resident/documents`
      );
    });

    it('resolves document to admin path when portalContext is admin', () => {
      const n = makeNotification({ type: 'DOCUMENT_SHARED', data: { buildingId: 'b-1' } });
      expect(resolveNotificationPath(n, TENANT_ID, mixedAdminPortal)).toBe(
        `/${TENANT_ID}/buildings/b-1/documents`
      );
    });

    it('resolves unit to resident path when portalContext is resident', () => {
      const n = makeNotification({ type: 'OCCUPANT_ASSIGNED', data: {} });
      expect(resolveNotificationPath(n, TENANT_ID, mixedResidentPortal)).toBe(
        `/${TENANT_ID}/resident/unit`
      );
    });

    it('resolves unit to admin path when portalContext is admin', () => {
      const n = makeNotification({ type: 'OCCUPANT_ASSIGNED', data: { buildingId: 'b-1' } });
      expect(resolveNotificationPath(n, TENANT_ID, mixedAdminPortal)).toBe(
        `/${TENANT_ID}/buildings/b-1/units`
      );
    });

    it('resolves ticket to resident path when portalContext is resident', () => {
      const n = makeNotification({ type: 'TICKET_COMMENT_ADDED', data: {} });
      expect(resolveNotificationPath(n, TENANT_ID, mixedResidentPortal)).toBe(
        `/${TENANT_ID}/resident/tickets`
      );
    });

    it('resolves ticket to admin path when portalContext is admin', () => {
      const n = makeNotification({ type: 'TICKET_STATUS_CHANGED', data: { buildingId: 'b-1' } });
      expect(resolveNotificationPath(n, TENANT_ID, mixedAdminPortal)).toBe(
        `/${TENANT_ID}/buildings/b-1/tickets`
      );
    });

    it('resolves fallback URL to resident path when portalContext is resident', () => {
      const n = makeNotification({
        type: 'SYSTEM_ALERT',
        data: { url: `/${TENANT_ID}/resident/dashboard` },
      });
      expect(resolveNotificationPath(n, TENANT_ID, mixedResidentPortal)).toBe(
        `/${TENANT_ID}/resident/dashboard`
      );
    });

    it('rejects resident fallback URL when portalContext is admin', () => {
      const n = makeNotification({
        type: 'SYSTEM_ALERT',
        data: { url: `/${TENANT_ID}/resident/dashboard` },
      });
      expect(resolveNotificationPath(n, TENANT_ID, mixedAdminPortal)).toBeNull();
    });

    it('resolves support ticket to support page regardless of portalContext', () => {
      const n = makeNotification({ type: 'SUPPORT_TICKET_STATUS_CHANGED', data: {} });
      expect(resolveNotificationPath(n, TENANT_ID, mixedResidentPortal)).toBe(
        `/${TENANT_ID}/support`
      );
      expect(resolveNotificationPath(n, TENANT_ID, mixedAdminPortal)).toBe(
        `/${TENANT_ID}/support`
      );
    });
  });
});
