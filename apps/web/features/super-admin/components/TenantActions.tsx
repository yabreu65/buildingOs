'use client';

import { useState } from 'react';
import type { Tenant } from '../super-admin.types';
import { useImpersonation } from '../../impersonation/useImpersonation';

interface TenantActionsProps {
  tenant: Tenant;
  onToggleSuspend: (tenant: Tenant) => void;
  isLoading?: boolean;
}

export default function TenantActions({
  tenant,
  onToggleSuspend,
  isLoading = false,
}: TenantActionsProps) {
  const { startImpersonation } = useImpersonation();
  const [isImpersonating, setIsImpersonating] = useState(false);

  // Only show actions for TRIAL and ACTIVE tenants
  const isActionable = tenant.status === 'TRIAL' || tenant.status === 'ACTIVE';

  const handleEnter = async () => {
    setIsImpersonating(true);
    try {
      await startImpersonation(tenant.id);
    } catch (error) {
      setIsImpersonating(false);
      console.error('Failed to impersonate tenant:', error);
      alert(`No se pudo iniciar impersonation: ${error instanceof Error ? error.message : 'Error desconocido'}`);
    }
  };

  if (!isActionable) {
    return (
      <div className="text-xs text-muted-foreground">
        Sin acciones
      </div>
    );
  }

  return (
    <div className="flex gap-1.5">
      <button
        onClick={handleEnter}
        disabled={isLoading || isImpersonating}
        className="text-xs px-2 py-1 rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap"
        title="Entrar como soporte (impersonación)"
      >
        {isImpersonating ? 'Entrando...' : 'Soporte'}
      </button>
      <button
        onClick={() => onToggleSuspend(tenant)}
        disabled={isLoading}
        className={`text-xs px-2 py-1 rounded border whitespace-nowrap disabled:opacity-50 ${
          tenant.status === 'SUSPENDED'
            ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
            : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
        }`}
        title={tenant.status === 'SUSPENDED' ? 'Reactivar tenant' : 'Suspender tenant'}
      >
        {tenant.status === 'SUSPENDED' ? 'Activar' : 'Suspender'}
      </button>
    </div>
  );
}
