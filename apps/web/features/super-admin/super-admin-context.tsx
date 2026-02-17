'use client';

import { createContext, ReactNode, useState, useEffect } from 'react';

export type SuperAdminContextType = {
  activeTenantId?: string;
  setActiveTenantId: (tenantId: string | undefined) => void;
};

export const SuperAdminContext = createContext<SuperAdminContextType | null>(null);

export function SuperAdminProvider({ children }: { children: ReactNode }) {
  const [activeTenantId, setActiveTenantId] = useState<string | undefined>();
  const [isHydrated, setIsHydrated] = useState(false);

  // Restaurar desde localStorage en el cliente
  useEffect(() => {
    const stored = localStorage.getItem('bo_active_tenant_id');
    if (stored) {
      setActiveTenantId(stored);
    }
    setIsHydrated(true);
  }, []);

  // Guardar en localStorage cuando cambia
  useEffect(() => {
    if (!isHydrated) return;
    if (activeTenantId) {
      localStorage.setItem('bo_active_tenant_id', activeTenantId);
    } else {
      localStorage.removeItem('bo_active_tenant_id');
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
