'use client';

import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getToken, setSession, setLastTenant, clearAuth } from './session.storage';
import { apiMe } from './auth.service';

/**
 * AuthBootstrap: intenta restaurar sesión desde el backend.
 *
 * Comportamiento para MVP (Sprint 3+):
 * - Si existe bo_token y llamada a /auth/me tiene éxito:
 *   → setSession(...) con datos frescos
 *   → setLastTenant()
 *
 * - Si existe bo_token pero /auth/me falla (401, network error, etc):
 *   → NO limpiar auth (dejar que el layout lea lo que hay en localStorage)
 *   → Si es 401 específicamente: sí limpiar auth (token inválido)
 *   → Si es network error: permitir que session en localStorage se use como fallback
 *
 * - Si no hay token:
 *   → no hacer nada
 */
export default function AuthBootstrap() {
  const router = useRouter();
  const pathname = usePathname();

  // Flag para evitar múltiples intentos en Strict Mode
  const didBootstrap = useRef(false);

  useEffect(() => {
    // Evitar doble ejecución en desarrollo (React 18 Strict Mode)
    if (didBootstrap.current) {
      return;
    }
    didBootstrap.current = true;

    const performBootstrap = async () => {
      const token = getToken();

      // Si no hay token, no hacer nada
      if (!token) {
        return;
      }

      try {
        // Llamar /auth/me para restaurar sesión
        const response = await apiMe();

        // Asegurar que tenemos user y memberships
        if (response.user && response.memberships && response.memberships.length > 0) {
          const { user, memberships } = response;
          const activeTenantId = memberships[0].tenantId;

          // Restaurar sesión con datos frescos del backend
          setSession({
            user,
            memberships,
            activeTenantId,
          });

          // Actualizar último tenant
          setLastTenant(activeTenantId);
        } else {
          // Response inválido (no tiene user o memberships): token está corrupto
          clearAuth();
          redirectToLoginIfPrivate();
        }
      } catch (error) {
        // Error al llamar /auth/me
        // Determinar si es un 401 específico (token inválido) o un error de red

        const is401 = error instanceof Error && error.message.includes('401');

        if (is401) {
          // Token inválido: limpiar auth
          clearAuth();
          redirectToLoginIfPrivate();
        } else {
          // Error de red u otro: NO limpiar auth
          // Dejar que el TenantLayout use la sesión en localStorage como fallback
          // (el usuario puede seguir usando la app en modo offline/degradado)
          console.warn('[AuthBootstrap] Error restaurando sesión (se usará localStorage como fallback):', error);
        }
      }
    };

    const redirectToLoginIfPrivate = () => {
      // Public routes que no necesitan redirigir
      const publicPaths = ['/', '/login', '/signup', '/health'];
      const isPublicPath = publicPaths.includes(pathname);

      if (!isPublicPath) {
        // ✅ For /super-admin routes: validation happens in SuperAdminLayout
        // TenantLayout + SuperAdminLayout will handle role-based access
        router.replace('/login');
      }
    };

    performBootstrap();
  }, [pathname, router]);

  // Este componente no renderiza nada
  return null;
}
