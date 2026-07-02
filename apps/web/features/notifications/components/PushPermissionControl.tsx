'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellOff, BellRing } from 'lucide-react';
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

interface PushPermissionControlProps {
  tenantId: string;
}

const initialStatus: PushStatus = {
  browserSubscribed: false,
  configured: false,
  permission: 'default',
  subscribed: false,
  supported: false,
};

export function PushPermissionControl({ tenantId }: PushPermissionControlProps) {
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
    refreshStatus().catch(() => {
      setError('No pudimos revisar el estado de alertas push.');
    });
  }, [refreshStatus]);

  const handleEnable = async () => {
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
  };

  const handleDisable = async () => {
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
  };

  const disabledReason = getDisabledReason(status);
  const isDisabled = isBusy || Boolean(disabledReason);
  const actionLabel = status.subscribed ? 'Desactivar alertas' : 'Activar alertas';
  const statusLabel = getStatusLabel(status);
  const Icon = status.subscribed ? BellRing : BellOff;

  return (
    <div className="flex max-w-xs items-center gap-2 rounded-lg border border-border bg-muted/40 px-2 py-1">
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <p className="truncate text-xs font-medium leading-tight">{statusLabel}</p>
        {(error || message) && (
          <p className={`truncate text-[11px] leading-tight ${error ? 'text-red-600' : 'text-green-700'}`}>
            {error ?? message}
          </p>
        )}
      </div>
      <button
        type="button"
        className="whitespace-nowrap rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={status.subscribed ? handleDisable : handleEnable}
        disabled={isDisabled}
        title={disabledReason ?? actionLabel}
      >
        {isBusy ? 'Guardando...' : actionLabel}
      </button>
    </div>
  );
}

function getStatusLabel(status: PushStatus): string {
  if (!status.supported) {
    return 'Alertas no compatibles';
  }
  if (!status.configured) {
    return 'Alertas no configuradas';
  }
  if (status.permission === 'denied') {
    return 'Alertas bloqueadas';
  }
  if (status.subscribed) {
    return 'Alertas push activas';
  }
  return 'Alertas push disponibles';
}

function getDisabledReason(status: PushStatus): string | null {
  if (!status.supported) {
    return 'Este navegador no permite alertas push.';
  }
  if (!status.configured) {
    return 'Falta configurar la clave pública VAPID.';
  }
  if (status.permission === 'denied') {
    return 'El permiso está bloqueado en el navegador.';
  }
  return null;
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
