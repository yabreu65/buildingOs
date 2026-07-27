'use client';

import { BellOff, BellRing } from 'lucide-react';
import { usePushPermission } from './PushPermissionProvider';

export function PushPermissionControl() {
  const { error, handleDisable, handleEnable, isBusy, message, status } = usePushPermission();

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
        className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={status.subscribed ? handleDisable : handleEnable}
        disabled={isDisabled}
        title={disabledReason ?? actionLabel}
      >
        {isBusy ? 'Guardando...' : actionLabel}
      </button>
    </div>
  );
}

function getStatusLabel(status: {
  readonly configured: boolean;
  readonly permission: NotificationPermission | 'unsupported';
  readonly subscribed: boolean;
  readonly supported: boolean;
}): string {
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

function getDisabledReason(status: {
  readonly configured: boolean;
  readonly permission: NotificationPermission | 'unsupported';
  readonly supported: boolean;
}): string | null {
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
