'use client';

import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { setSession, setLastTenant, clearAuth } from './session.storage';
import { apiMe } from './auth.service';
import { clearAllImpersonationData } from '../impersonation/impersonation.storage';
import { subscribeAuthUnauthorized } from '@/shared/lib/auth/events';
import { HttpError } from '@/shared/lib/http/client';

const PUBLIC_PATHS = ['/', '/login', '/signup', '/health', '/demo', '/demo-guiada', '/contact'];

/**
 * AuthBootstrap: intenta restaurar sesión desde el backend.
 */
export default function AuthBootstrap() {
  const router = useRouter();
  const pathname = usePathname();

  // Flag para evitar múltiples intentos en Strict Mode
  const didBootstrap = useRef(false);

  useEffect(() => {
    if (didBootstrap.current) {
      return;
    }
    didBootstrap.current = true;

    const performBootstrap = async () => {
      try {
        const response = await apiMe();

        if (response.user && response.memberships && response.memberships.length > 0) {
          const { user, memberships } = response;
          const activeTenantId = memberships[0].tenantId;

          clearAllImpersonationData();
          setSession({
            user,
            memberships,
            activeTenantId,
          });
          setLastTenant(activeTenantId);
          return;
        }

        clearAuth();
        redirectToLoginIfPrivate();
      } catch (error) {
        const is401 = error instanceof HttpError && error.status === 401;

        if (is401) {
          clearAllImpersonationData();
          clearAuth();
          redirectToLoginIfPrivate();
          return;
        }

        console.warn('[AuthBootstrap] Error restaurando sesión:', error);
      }
    };

    const redirectToLoginIfPrivate = () => {
      const isPublicPath = PUBLIC_PATHS.includes(pathname);

      if (!isPublicPath) {
        router.replace('/login');
      }
    };

    performBootstrap();
  }, [pathname, router]);

  useEffect(() => {
    const unsubscribe = subscribeAuthUnauthorized(() => {
      const isPublicPath = PUBLIC_PATHS.includes(pathname);

      if (!isPublicPath) {
        router.replace('/login');
      }
    });

    return unsubscribe;
  }, [pathname, router]);

  return null;
}
