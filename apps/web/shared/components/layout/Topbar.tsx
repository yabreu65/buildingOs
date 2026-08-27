'use client';

import { useRouter, useParams, usePathname, useSearchParams } from 'next/navigation';
import {
  setSession,
  setLastTenant,
  setLastPortal,
  getLastPortal,
} from '../../../features/auth/session.storage';
import { logout } from '@/features/auth/login.actions';
import { useTenants } from '../../../features/tenants/tenants.hooks';
import type { TenantSummary } from '../../../features/tenants/tenants.service';
import type { Membership } from '../../../features/auth/auth.types';
import Select from '../ui/Select';
import { Bell, CreditCard, X, Clock, CheckCircle, XCircle, MessageSquare, FileText, Home, Menu, ChevronDown } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { listNotifications, markAsRead, markAllAsRead, getUnreadCount, type Notification } from '@/features/notifications/notifications.api';
import { formatCurrency } from '@/shared/lib/format/money';
import { listPendingPayments, PaymentStatus } from '@/features/finance/services/finance.api';
import { PushPermissionControl } from '@/features/notifications/components/PushPermissionControl';
import { getNotificationCategory } from '@/shared/lib/notification-types';
import { resolveNotificationPath } from '@/shared/lib/notification-routes';
import {
  resolveAuthLandingRoute,
  resolveAuthorizedPortalContext,
} from '@/features/auth/landing-route';
import { useAuthSession } from '@/features/auth/useAuthSession';
import {
  notificationQueryKeys,
  useNotificationQueryCleanup,
} from '@/features/notifications/notification-queries';
import { notificationsCenterPath, residentDashboard, tenantDashboard } from '@/shared/lib/routes';

const ADMIN_ROLES = new Set(['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR', 'SUPER_ADMIN']);

const POLL_INTERVAL = 30_000;

export const PaymentNotificationBell = ({
  tenantId,
  currentSearch,
  isMobileMenuOpen = false,
}: {
  readonly tenantId: string;
  readonly currentSearch: string;
  readonly isMobileMenuOpen?: boolean;
}) => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const session = useAuthSession();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const userId = session?.user.id ?? null;

  const activeMembership = session?.memberships?.find((membership: Membership) => membership.tenantId === tenantId);
  const isAdmin = activeMembership?.roles?.some((candidateRole) => ADMIN_ROLES.has(candidateRole)) ?? false;
  const isResident = activeMembership?.roles?.includes('RESIDENT') ?? false;
  const portalContext =
    resolveAuthorizedPortalContext({
      session,
      tenantId,
      pathname,
      searchParamsString: currentSearch,
      preferredPortal: getLastPortal(),
    }) ?? 'admin';
  const roleContext = {
    isAdmin,
    isResident,
    portalContext,
  };
  const hasSession = Boolean(session);
  const notificationIdentity = useMemo(
    () => ({
      tenantId,
      userId,
    }),
    [tenantId, userId],
  );

  useNotificationQueryCleanup(notificationIdentity);

  // 1. Always-polling unread count for the badge
  const { data: unreadCount = 0 } = useQuery({
    queryKey: notificationQueryKeys.unreadCount(tenantId, userId ?? ''),
    queryFn: () => getUnreadCount(tenantId),
    enabled: hasSession && Boolean(tenantId) && Boolean(userId),
    refetchInterval: POLL_INTERVAL,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });

  // 2. Pending payments (admin only)
  const { data: pendingPayments = [] } = useQuery({
    queryKey: ['pendingPaymentsCount', tenantId],
    queryFn: () => listPendingPayments(tenantId, { status: PaymentStatus.SUBMITTED }),
    enabled: isAdmin,
    refetchInterval: POLL_INTERVAL,
    refetchOnWindowFocus: true,
  });

  const pendingCount = pendingPayments.length;

  // 3. Notification list — only when dropdown is open
  const {
    data: notificationResult,
    isLoading: listLoading,
    error: listError,
  } = useQuery({
    queryKey: notificationQueryKeys.list(tenantId, userId ?? '', { take: 20 }),
    queryFn: () => listNotifications(tenantId, { take: 20 }),
    enabled: hasSession && Boolean(tenantId) && Boolean(userId) && isOpen,
    refetchInterval: isOpen ? POLL_INTERVAL : false,
    refetchOnWindowFocus: true,
  });

  // 4. Mutations
  const markReadMutation = useMutation({
    mutationFn: (notificationId: string) => markAsRead(tenantId, notificationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationQueryKeys.scope(tenantId, userId ?? '') });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => markAllAsRead(tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationQueryKeys.scope(tenantId, userId ?? '') });
    },
  });

  // 5. Notifications for display
  const allNotifs = notificationResult?.notifications ?? [];
  const filteredNotifications: Notification[] = allNotifs;

  // Badge: unread notifications only. Pending payments remain in the auxiliary card.
  const badgeCount = unreadCount;

  const closeDropdown = useCallback((restoreFocus = false) => {
    setIsOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => buttonRef.current?.focus());
    }
  }, []);

  useLayoutEffect(() => {
    if (!isMobileMenuOpen || !isOpen) return;

    let isCurrentEffect = true;
    queueMicrotask(() => {
      if (isCurrentEffect) {
        closeDropdown(false);
      }
    });

    return () => {
      isCurrentEffect = false;
    };
  }, [closeDropdown, isMobileMenuOpen, isOpen]);

  // 6. Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        closeDropdown();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [closeDropdown, isOpen]);

  // 7. Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeDropdown(true);
      }
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [closeDropdown, isOpen]);

  // 8. Handlers
  const handleToggle = () => setIsOpen((prev) => !prev);

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.isRead) {
      await markReadMutation.mutateAsync(notification.id);
    }

    const targetPath = resolveNotificationPath(notification, tenantId, roleContext);
    if (targetPath) {
      router.push(targetPath);
    }
    closeDropdown(false);
  };

  const handleMarkAllRead = () => {
    markAllReadMutation.mutate();
  };

  const handleOpenNotificationsCenter = () => {
    router.push(notificationsCenterPath(tenantId, portalContext));
    closeDropdown(false);
  };

  const getNotificationIcon = (notification: Notification) => {
    const category = getNotificationCategory(notification.type);
    switch (category) {
      case 'payment':
        if (notification.type === 'PAYMENT_RECEIVED' || notification.data?.event === 'PAYMENT_APPROVED') {
          return <CheckCircle className="w-4 h-4 text-green-600" />;
        }
        if (notification.type === 'PAYMENT_REJECTED' || notification.data?.event === 'PAYMENT_REJECTED') {
          return <XCircle className="w-4 h-4 text-red-600" />;
        }
        return <CreditCard className="w-4 h-4 text-blue-600" />;
      case 'ticket':
        return <MessageSquare className="w-4 h-4 text-blue-600" />;
      case 'support':
        return <MessageSquare className="w-4 h-4 text-purple-600" />;
      case 'document':
        return <FileText className="w-4 h-4 text-yellow-600" />;
      case 'unit':
        return <Home className="w-4 h-4 text-cyan-600" />;
      default:
        if (notification.type === 'BUILDING_ALERT') {
          return <Clock className="w-4 h-4 text-amber-600" />;
        }
        return <Bell className="w-4 h-4 text-gray-600" />;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className="relative inline-flex size-11 items-center justify-center rounded-lg hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        title="Notificaciones"
        aria-label={`Notificaciones${badgeCount > 0 ? `, ${badgeCount} sin leer` : ''}`}
        aria-expanded={isOpen}
        aria-controls="notification-dropdown"
      >
        <Bell className="w-5 h-5" />
        {badgeCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center" aria-hidden="true">
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          id="notification-dropdown"
          role="menu"
          className="fixed inset-x-2 top-[calc(env(safe-area-inset-top)+3.5rem)] z-50 flex max-h-[calc(100dvh-env(safe-area-inset-top)-4.5rem)] flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-lg sm:inset-x-auto sm:right-3 sm:w-80 lg:absolute lg:right-0 lg:top-full lg:mt-2 lg:w-80"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border p-3">
            <span className="font-semibold">Notificaciones</span>
            <button
              type="button"
              onClick={() => closeDropdown(true)}
              className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Cerrar notificaciones"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            {listLoading && (
              <div className="p-4 text-center text-muted-foreground text-sm">
                Cargando notificaciones…
              </div>
            )}

            {listError && (
              <div className="p-4 text-center text-red-600 text-sm" role="alert">
                No se pudieron cargar las notificaciones
              </div>
            )}

            {!listLoading && !listError && filteredNotifications.length === 0 && pendingCount === 0 && (
              <div className="p-4 text-center text-muted-foreground">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No hay notificaciones nuevas</p>
              </div>
            )}

            {!listLoading && !listError && filteredNotifications.length === 0 && pendingCount > 0 && (
              <div className="p-4">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 dark:bg-amber-950 dark:border-amber-800">
                  <div className="flex items-start gap-2">
                    <Clock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm text-amber-800 dark:text-amber-200">
                        {pendingCount} pago{pendingCount > 1 ? 's' : ''} pendiente{pendingCount > 1 ? 's' : ''} por revisar
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                        Hay pagos que necesitan aprobación
                      </p>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    router.push(`/${tenantId}/finanzas?tab=payments`);
                    closeDropdown(false);
                  }}
                  className="min-h-11 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
                >
                  Revisar pagos →
                </button>
              </div>
            )}

            {!listLoading && !listError && filteredNotifications.length > 0 && (
              <div>
                {filteredNotifications.map((notification) => (
                  <button
                    key={notification.id}
                    role="menuitem"
                    onClick={() => handleNotificationClick(notification)}
                    className={`min-h-11 w-full text-left p-3 border-b border-border hover:bg-muted/50 transition-colors ${
                      !notification.isRead ? 'bg-blue-50/50 dark:bg-blue-950/30' : ''
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
                        <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-2" aria-label="No leída" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {(filteredNotifications.length > 0 || pendingCount > 0) && (
            <div className="shrink-0 border-t border-border bg-muted/30 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              {filteredNotifications.length > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  disabled={markAllReadMutation.isPending}
                  className="min-h-11 w-full text-xs font-medium text-primary hover:opacity-80 disabled:opacity-50"
                >
                  {markAllReadMutation.isPending ? 'Marcando…' : 'Marcar todas como leídas'}
                </button>
              )}
              <button
                onClick={() => {
                  router.push(isAdmin ? `/${tenantId}/finanzas?tab=payments` : `/${tenantId}/resident/payments`);
                  closeDropdown(false);
                }}
                className="mt-1 min-h-11 w-full text-xs text-muted-foreground hover:text-foreground"
              >
                Ver pagos →
              </button>
              <button
                onClick={handleOpenNotificationsCenter}
                className="mt-1 min-h-11 w-full text-xs text-muted-foreground hover:text-foreground"
              >
                Ver notificaciones →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface TopbarProps {
  readonly isMobileMenuOpen?: boolean;
  readonly menuButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly onMobileMenuToggle?: () => void;
}

export const Topbar = ({
  isMobileMenuOpen = false,
  menuButtonRef,
  onMobileMenuToggle,
}: TopbarProps) => {
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentSearch = searchParams.toString();
  const urlTenantId = typeof params?.tenantId === 'string' ? params.tenantId : undefined;
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isPortalMenuOpen, setIsPortalMenuOpen] = useState(false);
  const portalMenuRef = useRef<HTMLDivElement>(null);
  const session = useAuthSession();
  const { data: tenants, isLoading, error } = useTenants();

  useEffect(() => {
    const portal = resolveAuthorizedPortalContext({
      session,
      tenantId: urlTenantId,
      pathname,
      searchParamsString: currentSearch,
      preferredPortal: getLastPortal(),
    });
    if (portal) {
      setLastPortal(portal);
    }
  }, [currentSearch, pathname, session, urlTenantId]);

  // Determinar tenant activo: URL > session.activeTenantId > memberships[0]
  const activeTenantId =
    urlTenantId || session?.activeTenantId || session?.memberships[0]?.tenantId || '-';

  // Obtener tenant actual con nombre (fallback a ID si no está en la lista)
  const activeTenant = tenants?.find((t) => t.id === activeTenantId);
  const activeTenantName = activeTenant?.name || activeTenantId;

  // Obtener rol del usuario en el tenant activo
  const activeMembership = session?.memberships.find((m) => m.tenantId === activeTenantId);
  const isAdmin = activeMembership?.roles.some((candidateRole) => ADMIN_ROLES.has(candidateRole)) ?? false;
  const isResident = activeMembership?.roles.includes('RESIDENT') ?? false;
  const activePortal = resolveAuthorizedPortalContext({
    session,
    tenantId: activeTenantId,
    pathname,
    searchParamsString: currentSearch,
    preferredPortal: getLastPortal(),
  });
  const role =
    activePortal === 'resident' && activeMembership?.roles.includes('RESIDENT')
      ? 'RESIDENT'
      : activeMembership?.roles.find((candidateRole) => ADMIN_ROLES.has(candidateRole)) ||
        activeMembership?.roles[0] ||
        'Guest';

  const roleLabelMap: Record<string, string> = {
    TENANT_ADMIN: 'Administrador',
    TENANT_OWNER: 'Propietario',
    OPERATOR: 'Operador',
    RESIDENT: 'Residente',
    SUPER_ADMIN: 'Superadministrador',
    Guest: 'Invitado',
  };

  const roleLabel = roleLabelMap[role] || role;
  const canSwitchPortal = isAdmin && isResident;

  useEffect(() => {
    if (!isPortalMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!portalMenuRef.current?.contains(event.target as Node)) {
        setIsPortalMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsPortalMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isPortalMenuOpen]);

  const handleTenantChange = (nextTenantId: string) => {
    if (!session) return;
    const nextSession = {
      ...session,
      activeTenantId: nextTenantId,
    };

    // Actualizar sesión con nuevo tenant activo
    setSession(nextSession);

    // Persistir último tenant
    setLastTenant(nextTenantId);

    // Navegar al portal equivalente del nuevo tenant si existe
    router.replace(
      resolveAuthLandingRoute({
        session: nextSession,
        preferredTenantId: nextTenantId,
        preferredPortal: activePortal,
      }),
    );
  };

  const handlePortalChange = (nextPortal: 'admin' | 'resident') => {
    setLastPortal(nextPortal);
    setIsPortalMenuOpen(false);
    router.replace(
      nextPortal === 'resident'
        ? residentDashboard(activeTenantId)
        : tenantDashboard(activeTenantId),
    );
  };

  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
      router.replace('/login');
    }
  };

  // Si no hay sesión, mostrar estado vacío
  if (!session) {
    return (
      <header className="h-14 border-b border-border bg-card text-card-foreground flex items-center justify-between px-4">
        <div className="text-sm text-muted-foreground">Cargando...</div>
      </header>
    );
  }

  // Mostrar selector de tenant si hay múltiples memberships
  const canSelectTenant = session.memberships.length > 1;

  // Fallback si no hay tenants cargados: mostrar por ID
  const fallbackTenants: TenantSummary[] = tenants?.length ? tenants : session.memberships.map((membership: Membership) => ({
    id: membership.tenantId,
    name: membership.tenantId,
    type: 'EDIFICIO_AUTOGESTION' as const,
  }));

  return (
    <header className="border-b border-border bg-card text-card-foreground">
      <div className="flex min-h-14 items-center justify-between gap-2 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        {onMobileMenuToggle && (
          <button
            ref={menuButtonRef}
            type="button"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring lg:hidden"
            onClick={onMobileMenuToggle}
            aria-label="Abrir menú de navegación"
            aria-expanded={isMobileMenuOpen}
            aria-controls="mobile-navigation"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
        )}
        <div className="truncate text-sm font-semibold">BuildingOS</div>

        {canSelectTenant ? (
          <div className="hidden min-w-0 items-center gap-2 lg:flex">
            <label htmlFor="tenant-select-desktop" className="text-xs text-muted-foreground">
              {isLoading ? 'Cargando...' : 'Edificio:'}
            </label>
            <Select
              id="tenant-select-desktop"
              value={activeTenantId}
              onChange={(e) => handleTenantChange(e.target.value)}
              className="min-h-11 min-w-0 text-xs"
              disabled={isLoading}
            >
              {fallbackTenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
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
          <span className="hidden items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium lg:inline-flex">
            {activeTenantName}
          </span>
        )}
      </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
        {urlTenantId && <div className="hidden lg:block"><PushPermissionControl /></div>}
        {urlTenantId && (
          <PaymentNotificationBell
            tenantId={urlTenantId}
            currentSearch={currentSearch}
            isMobileMenuOpen={isMobileMenuOpen}
          />
        )}
        {canSwitchPortal ? (
          <div ref={portalMenuRef} className="relative">
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium transition hover:bg-muted/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              onClick={() => setIsPortalMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={isPortalMenuOpen}
              aria-controls="portal-context-menu"
            >
              {roleLabel}
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </button>
            {isPortalMenuOpen && (
              <div
                id="portal-context-menu"
                role="menu"
                aria-label="Cambiar portal"
                className="absolute right-0 top-full z-50 mt-2 min-w-40 rounded-lg border border-border bg-card p-1 text-card-foreground shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                  onClick={() => handlePortalChange('admin')}
                  aria-current={activePortal === 'admin' ? 'page' : undefined}
                >
                  Administrador
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                  onClick={() => handlePortalChange('resident')}
                  aria-current={activePortal === 'resident' ? 'page' : undefined}
                >
                  Residente
                </button>
              </div>
            )}
          </div>
        ) : (
          <span className="hidden items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium lg:inline-flex">
            {roleLabel}
          </span>
        )}

        <button
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          onClick={handleLogout}
          disabled={isLoggingOut}
          aria-busy={isLoggingOut}
        >
          {isLoggingOut ? 'Saliendo...' : 'Cerrar sesión'}
        </button>
        </div>
      </div>

      {canSelectTenant && (
        <div className="flex min-w-0 items-center gap-2 border-t border-border px-3 py-2 lg:hidden sm:px-4">
          <label htmlFor="tenant-select-mobile" className="shrink-0 text-xs text-muted-foreground">
            {isLoading ? 'Cargando...' : 'Edificio:'}
          </label>
          <Select
            id="tenant-select-mobile"
            value={activeTenantId}
            onChange={(e) => handleTenantChange(e.target.value)}
            className="min-h-11 min-w-0 flex-1 truncate text-xs"
            disabled={isLoading}
          >
            {fallbackTenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </Select>
          {error && (
            <span className="shrink-0 text-xs text-red-500" title="Error al cargar tenants">
              ⚠️
            </span>
          )}
        </div>
      )}
    </header>
  );
};

export default Topbar;
