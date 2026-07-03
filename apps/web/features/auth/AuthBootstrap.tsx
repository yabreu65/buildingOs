'use client';

import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { setSession, setLastTenant, clearAuth } from './session.storage';
import { apiMe } from './auth.service';
import { clearAllImpersonationData } from '../impersonation/impersonation.storage';
import { subscribeAuthUnauthorized } from '@/shared/lib/auth/events';
import { HttpError } from '@/shared/lib/http/client';
import { useToast } from '@/shared/components/ui/Toast';
import { reportFrontendError } from '@/shared/lib/observability/frontend-observability';

const PUBLIC_PATHS = ['/', '/login', '/signup', '/health', '/demo', '/demo-guiada', '/contact', '/invite'];

function getBootstrapErrorMessage(error: unknown): string {
  if (error instanceof HttpError) {
    return error.message || 'No pudimos verificar tu sesión. Revisá tu conexión e intentá otra vez.';
  }

  return 'No pudimos verificar tu sesión. Revisá tu conexión e intentá otra vez.';
}

/**
 * AuthBootstrap: intenta restaurar sesión desde el backend.
 */
export const AuthBootstrap = () => {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();

  // Flag para evitar múltiples intentos en Strict Mode
  const didBootstrap = useRef(false);
  const isPublicPath = PUBLIC_PATHS.includes(pathname);

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

        reportFrontendError(new Error('Invalid session bootstrap payload'), {
          source: 'api-client',
          level: 'page',
          path: pathname,
        });

        toast(getBootstrapErrorMessage(new Error('Invalid session bootstrap payload')), 'error', 5000);

        clearAllImpersonationData();
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

        const bootstrapError = error instanceof Error ? error : new Error('Unexpected auth bootstrap error');

        reportFrontendError(bootstrapError, {
          source: 'api-client',
          level: 'page',
          path: pathname,
        });

        toast(getBootstrapErrorMessage(error), 'error', 5000);
      }
    };

    const redirectToLoginIfPrivate = () => {
      if (!isPublicPath) {
        router.replace('/login');
      }
    };

    performBootstrap();
  }, [pathname, router, toast]);

  useEffect(() => {
    const unsubscribe = subscribeAuthUnauthorized(() => {
      if (!isPublicPath) {
        router.replace('/login');
      }
    });

    return unsubscribe;
  }, [pathname, router]);

  return null;
};
