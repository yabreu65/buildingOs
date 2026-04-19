'use client';

import { useRouter, useParams } from 'next/navigation';
import { getSession, setSession, setLastTenant, clearAuth } from '../../../features/auth/session.storage';
import { useTenants } from '../../../features/tenants/tenants.hooks';
import Select from '../ui/Select';
import { Bell, CreditCard, X, Check, AlertCircle, Clock, CheckCircle, XCircle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useRef, useMemo } from 'react';
import { listNotifications, getUnreadCount, markAsRead, type Notification } from '@/features/notifications/notifications.api';
import { formatCurrency } from '@/shared/lib/format/money';
import { listPendingPayments, PaymentStatus } from '@/features/finance/services/finance.api';

function PaymentNotificationBell({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Get user role from session
  const session = getSession();
  const activeMembership = session?.memberships?.find((m: any) => m.tenantId === tenantId);
  const role = activeMembership?.roles?.[0] || 'RESIDENT';
  
  const isAdmin = ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR', 'SUPER_ADMIN'].includes(role);
  const isResident = role === 'RESIDENT';

  // For admin: show pending SUBMITTED payments in badge
  const { data: pendingPayments = [] } = useQuery({
    queryKey: ['pendingPaymentsCount', tenantId],
    queryFn: () => listPendingPayments(tenantId, { status: PaymentStatus.SUBMITTED }),
    enabled: isAdmin,
    refetchInterval: 180000, // Poll every 3 minutes
    refetchOnWindowFocus: true,
  });

  const pendingCount = pendingPayments.length;

  // For everyone: get notifications (different filter based on role)
  const { data: notifications = [] } = useQuery({
    queryKey: ['notificationList', tenantId],
    queryFn: () => listNotifications({ take: 20, isRead: false }),
    enabled: isOpen,
    refetchInterval: 180000,
  });

  const markReadMutation = useMutation({
    mutationFn: markAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationList'] });
    },
  });

  // Filter notifications based on role
  const allNotifs = (notifications as any)?.notifications || [];
  
  let filteredNotifications: Notification[] = [];
  let badgeCount = 0;

  if (isAdmin) {
    // Admin: show BUILDING_ALERT for new payments pending review
    filteredNotifications = allNotifs.filter((n: Notification) => 
      (n.type === 'BUILDING_ALERT' && n.data?.event === 'PAYMENT_SUBMITTED') ||
      n.data?.paymentId
    );
    badgeCount = pendingCount; // Badge shows pending payments count
  } else {
    // Resident: show PAYMENT_RECEIVED and PAYMENT_REJECTED
    filteredNotifications = allNotifs.filter((n: Notification) => 
      n.type === 'PAYMENT_RECEIVED' || 
      n.type === 'PAYMENT_REJECTED' ||
      n.data?.event === 'PAYMENT_APPROVED' ||
      n.data?.event === 'PAYMENT_REJECTED'
    );
    // Badge shows count of unread personal payment notifications
    badgeCount = filteredNotifications.filter((n: Notification) => !n.isRead).length;
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNotificationClick = async (notification: Notification) => {
    // Mark as read
    if (!notification.isRead) {
      await markReadMutation.mutateAsync(notification.id);
    }
    
    // Route based on role
    if (isAdmin) {
      router.push(`/${tenantId}/finanzas?tab=payments`);
    } else {
      router.push(`/${tenantId}/resident/payments`);
    }
    setIsOpen(false);
  };

  const handleMarkAllRead = async () => {
    for (const n of filteredNotifications) {
      if (!n.isRead) {
        await markReadMutation.mutateAsync(n.id);
      }
    }
  };

  // Get icon and color based on notification type
  const getNotificationIcon = (notification: Notification) => {
    if (notification.type === 'PAYMENT_RECEIVED' || notification.data?.event === 'PAYMENT_APPROVED') {
      return <CheckCircle className="w-4 h-4 text-green-600" />;
    }
    if (notification.type === 'PAYMENT_REJECTED' || notification.data?.event === 'PAYMENT_REJECTED') {
      return <XCircle className="w-4 h-4 text-red-600" />;
    }
    if (notification.type === 'BUILDING_ALERT') {
      return <Clock className="w-4 h-4 text-amber-600" />;
    }
    return <CreditCard className="w-4 h-4 text-blue-600" />;
  };

  // Determine empty state message based on role
  const getEmptyMessage = () => {
    if (isAdmin) {
      return { icon: <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500" />, text: 'No hay pagos pendientes por revisar' };
    } else {
      return { icon: <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />, text: 'No tenés notificaciones de pagos' };
    }
  };

  const emptyState = getEmptyMessage();

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg hover:bg-muted transition-colors"
        title={isAdmin ? 'Pagos pendientes por aprobar' : 'Mis notificaciones de pagos'}
      >
        <Bell className="w-5 h-5" />
        {badgeCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-card border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b">
            <span className="font-semibold">
              {isAdmin ? 'Pagos pendientes' : 'Mis pagos'}
            </span>
            <button 
              onClick={() => setIsOpen(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {filteredNotifications.length === 0 && pendingCount === 0 ? (
              <div className="p-4 text-center text-muted-foreground">
                {emptyState.icon}
                <p className="text-sm">{emptyState.text}</p>
              </div>
            ) : filteredNotifications.length === 0 && pendingCount > 0 ? (
              <div className="p-4">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                  <div className="flex items-start gap-2">
                    <Clock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm text-amber-800">
                        {pendingCount} pago{pendingCount > 1 ? 's' : ''} pendiente{pendingCount > 1 ? 's' : ''} por revisar
                      </p>
                      <p className="text-xs text-amber-700 mt-1">
                        Hay pagos que necesitan aprobación
                      </p>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    router.push(`/${tenantId}/finanzas?tab=payments`);
                    setIsOpen(false);
                  }}
                  className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Revisar pagos →
                </button>
              </div>
            ) : (
              <div>
                {filteredNotifications.map((notification) => (
                  <button
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`w-full text-left p-3 border-b hover:bg-muted/50 transition-colors ${
                      !notification.isRead ? 'bg-blue-50/50' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 flex-shrink-0">
                        {getNotificationIcon(notification)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{notification.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{notification.body}</p>
                        {notification.data?.paymentAmount && (
                          <p className="text-xs font-semibold text-green-600 mt-1">
                            {formatCurrency(notification.data.paymentAmount * 100, notification.data.paymentCurrency || 'ARS')}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(notification.createdAt).toLocaleString('es-AR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </p>
                      </div>
                      {!notification.isRead && (
                        <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-2" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {(filteredNotifications.length > 0 || pendingCount > 0) && (
            <div className="p-2 border-t bg-muted/30">
              {filteredNotifications.length > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  disabled={markReadMutation.isPending}
                  className="w-full text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  {markReadMutation.isPending ? 'Marcando...' : 'Marcar todas como leídas'}
                </button>
              )}
              <button
                onClick={() => {
                  router.push(isAdmin ? `/${tenantId}/finanzas?tab=payments` : `/${tenantId}/resident/payments`);
                  setIsOpen(false);
                }}
                className="w-full text-xs text-muted-foreground hover:text-foreground mt-1"
              >
                Ver todos los pagos →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Topbar() {
  const router = useRouter();
  const params = useParams();
  const urlTenantId = params?.tenantId as string | undefined;

  const session = getSession();
  const { data: tenants, isLoading, error } = useTenants();

  // Determinar tenant activo: URL > session.activeTenantId > memberships[0]
  const activeTenantId =
    urlTenantId || session?.activeTenantId || session?.memberships[0]?.tenantId || '-';

  // Obtener tenant actual con nombre (fallback a ID si no está en la lista)
  const activeTenant = tenants?.find((t) => t.id === activeTenantId);
  const activeTenantName = activeTenant?.name || activeTenantId;

  // Obtener rol del usuario en el tenant activo
  const activeMembership = session?.memberships.find((m) => m.tenantId === activeTenantId);
  const role = activeMembership?.roles[0] || 'Guest';

  const handleTenantChange = (nextTenantId: string) => {
    if (!session) return;

    // Actualizar sesión con nuevo tenant activo
    setSession({
      ...session,
      activeTenantId: nextTenantId,
    });

    // Persistir último tenant
    setLastTenant(nextTenantId);

    // Navegar al dashboard del nuevo tenant
    router.replace(`/${nextTenantId}/dashboard`);
  };

  const handleLogout = () => {
    clearAuth();
    router.replace('/login');
  };

  // Si no hay sesión, mostrar estado vacío
  if (!session) {
    return (
      <header className="h-14 border-b border-border bg-card text-card-foreground flex items-center justify-between px-4">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </header>
    );
  }

  // Mostrar selector de tenant si hay múltiples memberships
  const canSelectTenant = session.memberships.length > 1;

  // Fallback si no hay tenants cargados: mostrar por ID
  const fallbackTenants = tenants || session.memberships.map((m: any) => ({
    id: m.tenantId,
    name: m.tenantId,
    type: 'EDIFICIO_AUTOGESTION' as const,
  }));

  return (
    <header className="h-14 border-b border-border bg-card text-card-foreground flex items-center justify-between px-4">
      <div className="flex items-center gap-4">
        <div className="text-sm font-semibold">BuildingOS</div>

        {canSelectTenant ? (
          <div className="flex items-center gap-2">
            <label htmlFor="tenant-select" className="text-xs text-muted-foreground">
              {isLoading ? 'Cargando...' : 'Edificio:'}
            </label>
            <Select
              id="tenant-select"
              value={activeTenantId}
              onChange={(e) => handleTenantChange(e.target.value)}
              className="text-xs"
              disabled={isLoading}
            >
              {fallbackTenants.map((t: any) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            {error && (
              <span className="text-xs text-red-500" title="Error al cargar tenants">
                ⚠️
              </span>
            )}
          </div>
        ) : (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium">
            {activeTenantName}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {urlTenantId && <PaymentNotificationBell tenantId={urlTenantId} />}
        <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium">
          {role}
        </span>

        <button
          className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
          onClick={handleLogout}
        >
          Logout
        </button>
      </div>
    </header>
  );
}