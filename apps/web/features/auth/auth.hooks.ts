'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiLogin, apiSignup } from './auth.service';
import {
  getLastPortal,
  getLastTenant,
  setSession,
  setLastTenant,
} from './session.storage';
import { logout as performLogout } from './login.actions';
import { clearAllImpersonationData } from '../impersonation/impersonation.storage';
import type { AuthSession } from './auth.types';
import { resolveActiveTenantId, resolveAuthLandingRoute } from './landing-route';

interface AuthNavigationOptions {
  readonly requestedPath?: string | null;
}

export const useLogin = (options: AuthNavigationOptions = {}) => {
  const router = useRouter();

  return useMutation({
    mutationFn: apiLogin,
    onSuccess: (response) => {
      const { user, memberships } = response;

      if (memberships.length === 0) {
        throw new Error('No tienes membresías válidas');
      }

      const activeTenantId = resolveActiveTenantId(memberships, [getLastTenant()]);
      const session: AuthSession = {
        user,
        memberships,
        activeTenantId,
      };

      clearAllImpersonationData();
      setSession(session);
      setLastTenant(activeTenantId);

      router.push(
        resolveAuthLandingRoute({
          session,
          requestedPath: options.requestedPath ?? null,
          preferredTenantId: activeTenantId,
          preferredPortal: getLastPortal(),
        }),
      );
    },
  });
};

export const useSignup = (options: AuthNavigationOptions = {}) => {
  const router = useRouter();

  return useMutation({
    mutationFn: apiSignup,
    onSuccess: (response) => {
      const { user, memberships } = response;

      if (memberships.length === 0) {
        throw new Error('Error creando membresía');
      }

      const activeTenantId = resolveActiveTenantId(memberships, [getLastTenant()]);
      const session: AuthSession = {
        user,
        memberships,
        activeTenantId,
      };

      clearAllImpersonationData();
      setSession(session);
      setLastTenant(activeTenantId);

      router.push(
        resolveAuthLandingRoute({
          session,
          requestedPath: options.requestedPath ?? null,
          preferredTenantId: activeTenantId,
          preferredPortal: getLastPortal(),
        }),
      );
    },
  });
};

export const useLogout = () => {
  const router = useRouter();

  return async () => {
    await performLogout();
    router.push('/login');
  };
};
