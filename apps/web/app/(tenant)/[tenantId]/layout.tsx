'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppShell from '../../../shared/components/layout/AppShell';
import { getSession, setLastTenant } from '../../../features/auth/session.storage';
import { useIsSuperAdmin } from '../../../features/auth/useAuthSession';
import { useImpersonation } from '../../../features/impersonation/useImpersonation';
import { useBoStorageTick } from '../../../shared/lib/storage/useBoStorage';

type TenantParams = {
  tenantId?: string;
  [key: string]: string | string[] | undefined;
};

type AuthState = 'loading' | 'authorized' | 'unauthorized';

/**
 * TenantLayout: Protege rutas multi-tenant con validación de membership.
 *
 * Lógica:
 * 1. En SSR/inicial: no validar (evita SSR/localStorage issues)
 * 2. Tras hidratación:
 *    - Si NO hay sesión: no autorizado (ir a /login)
 *    - Si hay sesión: validar membership
 * 3. Nunca renderizar null: siempre mostrar UI (AppShell o loader)
 */
export default function TenantLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const router = useRouter();
  const params = useParams<TenantParams>();
  const tenantId = params?.tenantId;
  const isSuperAdmin = useIsSuperAdmin();
  const { isImpersonating } = useImpersonation();
  const storageTick = useBoStorageTick();

  const [authState, setAuthState] = useState<AuthState>('loading');

  // Redirigir SUPER_ADMIN a /super-admin (but NOT if impersonating)
  useEffect(() => {
    if (isSuperAdmin && !isImpersonating) {
      router.replace('/super-admin');
    }
  }, [isSuperAdmin, isImpersonating, router]);

  // Validar acceso tan pronto como se hidrata
  useEffect(() => {
    // Si es SUPER_ADMIN y NO está impersonando, no validar acceso de tenant (ya se está redirigiendo)
    if (isSuperAdmin && !isImpersonating) {
      return;
    }

    validateAccess();
  }, [isSuperAdmin, isImpersonating, tenantId, storageTick]);

  useEffect(() => {
    if (authState !== 'loading') {
      return;
    }

    const timer = window.setTimeout(() => {
      const session = getSession();
      if (!session) {
        setAuthState('unauthorized');
      }
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [authState, tenantId, storageTick]);

  const validateAccess = () => {
    // 1. Validar que tenemos tenantId
    if (typeof tenantId !== 'string' || tenantId.length === 0) {
      // No hay tenantId en la URL: mostrar loader (no redirigir, App Router resolverá)
      setAuthState('loading');
      return;
    }

    // 2. Leer sesión (AuthBootstrap la restaura con la cookie HttpOnly)
    const session = getSession();

    if (!session) {
      setAuthState('loading');
      return;
    }

    // 3. Validar membership
    const hasMembership = session.memberships.some((m) => m.tenantId === tenantId);

    if (!hasMembership) {
      setAuthState('unauthorized');
      return;
    }

    // 4. OK: autorizado
    setLastTenant(tenantId);
    setAuthState('authorized');
  };

  // Si no autorizado: redirigir a login (pero esperar a que se haya validado)
  useEffect(() => {
    if (authState === 'unauthorized') {
      router.replace('/login');
    }
  }, [authState, router]);

  // Render: nunca null
  // ✅ While auth is loading, show neutral loader (no tenant UI)
  if (authState === 'loading' || (isSuperAdmin && !isImpersonating)) {
    // SUPER_ADMIN being redirected to /super-admin, OR auth still loading
    // Show neutral loader without tenant sidebar/UI
    return <div className="min-h-screen bg-background" />;
  }

  // ✅ Authorized: render tenant UI
  if (authState === 'authorized') {
    return <AppShell>{children}</AppShell>;
  }

  // ✅ Unauthorized: being redirected to /login
  return <div className="min-h-screen bg-background" />;
}
