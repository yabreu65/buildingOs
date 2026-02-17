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

  return (
    <div className="flex gap-2">
      <button
        onClick={handleEnter}
        disabled={isLoading || isImpersonating}
        className="text-xs text-blue-600 hover:underline disabled:opacity-50"
      >
        {isImpersonating ? 'Entrando...' : 'Entrar como soporte'}
      </button>
      <button
        onClick={() => onToggleSuspend(tenant)}
        disabled={isLoading}
        className={`text-xs disabled:opacity-50 ${
          tenant.status === 'SUSPENDED'
            ? 'text-green-600 hover:underline'
            : 'text-red-600 hover:underline'
        }`}
      >
        {tenant.status === 'SUSPENDED' ? 'Activar' : 'Suspender'}
      </button>
    </div>
  );
}
