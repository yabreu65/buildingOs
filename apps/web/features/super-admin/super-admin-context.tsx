'use client';

import { createContext, ReactNode, useState, useEffect } from 'react';
import { StorageService } from '@/shared/lib/storage';

export interface SuperAdminContextType {
  activeTenantId?: string;
  setActiveTenantId: (tenantId: string | undefined) => void;
}

/**
 * Context for managing the active tenant in super-admin interface.
 * Provides access to tenant switching functionality.
 */
export const SuperAdminContext = createContext<SuperAdminContextType | null>(null);

/**
 * Provider component for SuperAdminContext.
 * Manages active tenant state with localStorage persistence.
 */
export function SuperAdminProvider({ children }: { children: ReactNode }) {
  const [activeTenantId, setActiveTenantId] = useState<string | undefined>();
  const [isHydrated, setIsHydrated] = useState(false);

  // Restaurar desde localStorage en el cliente
  useEffect(() => {
    const stored = StorageService.get<string>('active_tenant_id');
    if (stored) {
      setActiveTenantId(stored);
    }
    setIsHydrated(true);
  }, []);

  // Guardar en localStorage cuando cambia
  useEffect(() => {
    if (!isHydrated) return;
    if (activeTenantId) {
      StorageService.set('active_tenant_id', activeTenantId);
    } else {
      StorageService.remove('active_tenant_id');
    }
  }, [activeTenantId, isHydrated]);

  const value: SuperAdminContextType = {
    activeTenantId,
    setActiveTenantId,
  };

  return (
    <SuperAdminContext.Provider value={value}>
      {children}
    </SuperAdminContext.Provider>
  );
}
