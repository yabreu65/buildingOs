'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppShell from '../../../shared/components/layout/AppShell';
import { getSession, getToken, setLastTenant } from '../../../features/auth/session.storage';
import { useIsSuperAdmin } from '../../../features/auth/useAuthSession';
import { useImpersonation } from '../../../features/impersonation/useImpersonation';

type TenantParams = {
  tenantId?: string;
};

type AuthState = 'loading' | 'authorized' | 'unauthorized';

/**
 * TenantLayout: Protege rutas multi-tenant con validación de membership.
 *
 * Lógica:
 * 1. En SSR/inicial: no validar (evita SSR/localStorage issues)
 * 2. Tras hidratación:
 *    - Si NO hay token: no autorizado (ir a /login)
 *    - Si hay token pero NO hay sesión: permitir entrada (AuthBootstrap la está restaurando)
 *    - Si hay token + sesión: validar membership
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

  const [authState, setAuthState] = useState<AuthState>('loading');
  const didInitialize = useRef(false);

  // Redirigir SUPER_ADMIN a /super-admin (but NOT if impersonating)
  useEffect(() => {
    if (isSuperAdmin && !isImpersonating) {
      router.replace('/super-admin');
    }
  }, [isSuperAdmin, isImpersonating, router]);

  // Validar acceso tan pronto como se hidrata
  useEffect(() => {
    if (didInitialize.current) return;
    didInitialize.current = true;

    // Si es SUPER_ADMIN y NO está impersonando, no validar acceso de tenant (ya se está redirigiendo)
    if (isSuperAdmin && !isImpersonating) {
      return;
    }

    validateAccess();
  }, [isSuperAdmin, isImpersonating]);

  const validateAccess = () => {
    // 1. Validar que tenemos tenantId
    if (typeof tenantId !== 'string' || tenantId.length === 0) {
      // No hay tenantId en la URL: mostrar loader (no redirigir, App Router resolverá)
      setAuthState('loading');
      return;
    }

    // 2. Validar que hay token (requisito mínimo)
    const token = getToken();
    if (!token) {
      // No hay token: no autorizado
      setAuthState('unauthorized');
      return;
    }

    // 3. Leer sesión (puede estar vacía si AuthBootstrap aún no restauró)
    const session = getSession();

    if (!session) {
      // Hay token pero no sesión: asumir que AuthBootstrap la está restaurando
      // ⚠️ IMPORTANTE: Permitir acceso aunque no haya sesión en localStorage
      // AuthBootstrap puede estar restaurando en background, o puede haber fallado
      // En cualquier caso, si hay token válido, permitimos entrada
      setLastTenant(tenantId);
      setAuthState('authorized');
      return;
    }

    // 4. Validar membership
    const hasMembership = session.memberships.some((m) => m.tenantId === tenantId);

    if (!hasMembership) {
      // Token + sesión, pero sin access a este tenant
      setAuthState('unauthorized');
      return;
    }

    // 5. OK: autorizado
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
