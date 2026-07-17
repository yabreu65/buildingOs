'use client';

import { useState } from 'react';
import type { TenantFromAPI } from '../tenants.api';
import type { Tenant } from '../super-admin.types';
import { useImpersonation } from '../../impersonation/useImpersonation';
import Button from '@/shared/components/ui/Button';

interface TenantActionsProps {
  tenant: TenantFromAPI | Tenant;
  onToggleSuspend?: (tenant: Tenant) => void;
  onDeleteDemo?: (tenant: { id: string; name: string; isDemo?: boolean }) => Promise<void>;
  isLoading?: boolean;
}

export default function TenantActions({
  tenant,
  onToggleSuspend,
  onDeleteDemo,
  isLoading = false,
}: TenantActionsProps) {
  const { startImpersonation } = useImpersonation();
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeletingDemo, setIsDeletingDemo] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [impersonationError, setImpersonationError] = useState<string | null>(null);

  // Only show actions for TRIAL and ACTIVE tenants
  const subscription = 'subscription' in tenant ? tenant.subscription : null;
  const legacyStatus = 'status' in tenant ? tenant.status : undefined;
  const isActionable = subscription?.status === 'TRIAL' || subscription?.status === 'ACTIVE' || legacyStatus === 'TRIAL' || legacyStatus === 'ACTIVE';
  const isDemoTenant = Boolean(tenant.isDemo);

  const handleEnter = async () => {
    setIsImpersonating(true);
    setImpersonationError(null);
    try {
      await startImpersonation(tenant.id);
    } catch (error) {
      setIsImpersonating(false);
      console.error('Failed to impersonate tenant:', error);
      setImpersonationError(
        error instanceof Error ? error.message : 'No se pudo iniciar la sesión de soporte'
      );
    }
  };

  const handleDeleteDemo = async () => {
    if (!onDeleteDemo) {
      setShowDeleteModal(false);
      return;
    }

    try {
      setIsDeletingDemo(true);
      setDeleteError(null);
      await onDeleteDemo(tenant);
      setShowDeleteModal(false);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'No se pudo eliminar el demo');
    } finally {
      setIsDeletingDemo(false);
    }
  };

  if (!isActionable && !isDemoTenant) {
    return (
      <div className="text-xs text-muted-foreground">
        Sin acciones
      </div>
    );
  }

  return (
    <>
      <div className="flex gap-1.5 flex-wrap">
        {isActionable && (
          <button
            type="button"
            onClick={handleEnter}
            disabled={isLoading || isImpersonating}
            className="text-xs px-2 py-1 rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap"
            title="Entrar como soporte"
            aria-label={`Entrar como soporte en ${tenant.name}`}
          >
            {isImpersonating ? 'Ingresando...' : 'Soporte'}
          </button>
        )}
        <span className="self-center text-xs text-muted-foreground">Suspensión próximamente disponible</span>
        {isDemoTenant && (
          <button
            type="button"
            onClick={() => {
              setDeleteError(null);
              setShowDeleteModal(true);
            }}
            disabled={isLoading}
            className="text-xs px-2 py-1 rounded border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50 whitespace-nowrap"
            title="Eliminar datos de prueba"
            aria-label={`Eliminar datos de prueba de ${tenant.name}`}
          >
            Eliminar demo
          </button>
        )}
      </div>

      {impersonationError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {impersonationError}
        </div>
      )}

      {showDeleteModal && isDemoTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-red-200 bg-card p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-foreground">Eliminar datos de prueba</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Vas a borrar esta administradora de prueba y todos sus datos de demo. Esta acción es irreversible.
            </p>
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              Confirma solo si quieres limpiar datos de prueba.
            </p>

            {deleteError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {deleteError}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteError(null);
                }}
                disabled={isDeletingDemo}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handleDeleteDemo}
                disabled={isDeletingDemo}
                className="bg-red-600 hover:bg-red-700"
              >
                {isDeletingDemo ? 'Eliminando...' : 'Sí, eliminar datos de prueba'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
