'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  getExistingPushSubscription,
  getVapidPublicKey,
  isWebPushSupported,
  PushSubscriptionError,
  subscribeToWebPush,
  unsubscribeFromWebPush,
} from '../push-subscription.api';

type PermissionState = NotificationPermission | 'unsupported';

interface PushStatus {
  browserSubscribed: boolean;
  configured: boolean;
  permission: PermissionState;
  subscribed: boolean;
  supported: boolean;
}

interface PushPermissionContextValue {
  readonly error: string | null;
  readonly handleDisable: () => Promise<void>;
  readonly handleEnable: () => Promise<void>;
  readonly isBusy: boolean;
  readonly message: string | null;
  readonly refreshStatus: (activeTenantSubscribed?: boolean) => Promise<void>;
  readonly status: PushStatus;
}

const initialStatus: PushStatus = {
  browserSubscribed: false,
  configured: false,
  permission: 'default',
  subscribed: false,
  supported: false,
};

const PushPermissionContext = createContext<PushPermissionContextValue | null>(null);

interface PushPermissionProviderProps {
  readonly children: ReactNode;
  readonly tenantId: string;
}

export function PushPermissionProvider({ children, tenantId }: PushPermissionProviderProps) {
  const [status, setStatus] = useState<PushStatus>(initialStatus);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async (activeTenantSubscribed?: boolean) => {
    const supported = isWebPushSupported();
    const configured = Boolean(getVapidPublicKey());

    if (!supported) {
      setStatus({
        browserSubscribed: false,
        configured,
        permission: 'unsupported',
        subscribed: false,
        supported,
      });
      return;
    }

    const baseStatus = {
      configured,
      permission: Notification.permission,
      supported,
    } satisfies Pick<PushStatus, 'configured' | 'permission' | 'supported'>;

    setStatus((current) => ({
      ...current,
      ...baseStatus,
      subscribed: activeTenantSubscribed ?? current.subscribed,
    }));

    const subscription = await getExistingPushSubscription();
    setStatus((current) => ({
      ...current,
      ...baseStatus,
      browserSubscribed: Boolean(subscription),
      subscribed: activeTenantSubscribed ?? current.subscribed,
    }));
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      refreshStatus().catch(() => {
        setError('No pudimos revisar el estado de alertas push.');
      });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [refreshStatus, tenantId]);

  const handleEnable = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      await subscribeToWebPush(tenantId);
      setMessage('Alertas push activadas en este dispositivo.');
      await refreshStatus(true);
    } catch (caught) {
      setError(getUserFacingError(caught));
      await refreshStatus().catch(() => undefined);
    } finally {
      setIsBusy(false);
    }
  }, [refreshStatus, tenantId]);

  const handleDisable = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      const result = await unsubscribeFromWebPush(tenantId);
      if (result.unsubscribed) {
        setMessage('Alertas push desactivadas en este dispositivo.');
      } else {
        setError(getIncompleteUnsubscribeMessage(result.endpoint));
      }
      await refreshStatus(false);
    } catch (caught) {
      setError(getUserFacingError(caught));
      await refreshStatus().catch(() => undefined);
    } finally {
      setIsBusy(false);
    }
  }, [refreshStatus, tenantId]);

  const value = useMemo<PushPermissionContextValue>(
    () => ({
      error,
      handleDisable,
      handleEnable,
      isBusy,
      message,
      refreshStatus,
      status,
    }),
    [error, handleDisable, handleEnable, isBusy, message, refreshStatus, status],
  );

  return <PushPermissionContext.Provider value={value}>{children}</PushPermissionContext.Provider>;
}

export function usePushPermission() {
  const context = useContext(PushPermissionContext);

  if (!context) {
    throw new Error('usePushPermission must be used within a PushPermissionProvider');
  }

  return context;
}

function getUserFacingError(caught: unknown): string {
  if (caught instanceof PushSubscriptionError) {
    if (caught.code === 'permission-denied') {
      return 'No activamos alertas porque el permiso no fue concedido.';
    }
    if (caught.code === 'missing-public-key') {
      return 'Falta configurar la clave pública VAPID.';
    }
    if (caught.code === 'missing-tenant') {
      return 'Falta el contexto del consorcio activo.';
    }
    if (caught.code === 'missing-subscription-keys') {
      return 'No pudimos activar alertas porque el navegador no entregó las claves necesarias.';
    }
    if (caught.code === 'unsupported') {
      return 'Este navegador no permite alertas push.';
    }
  }

  return 'No pudimos actualizar las alertas push.';
}

function getIncompleteUnsubscribeMessage(endpoint: string | null): string {
  if (!endpoint) {
    return 'No encontramos una suscripción push local para desactivar.';
  }

  return 'Desactivamos el registro, pero el navegador no confirmó la baja local.';
}
