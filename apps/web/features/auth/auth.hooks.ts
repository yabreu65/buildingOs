'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiLogin, apiSignup, type LoginPayload, type SignupPayload } from './auth.service';
import { setSession, setLastTenant } from './session.storage';
import { logout as performLogout } from './login.actions';
import { clearAllImpersonationData } from '../impersonation/impersonation.storage';
import type { AuthSession } from './auth.types';

export const useLogin = () => {
  const router = useRouter();

  return useMutation({
    mutationFn: apiLogin,
    onSuccess: (response) => {
      const { user, memberships } = response;

      if (memberships.length === 0) {
        throw new Error('No tienes membresías válidas');
      }

      const activeTenantId = memberships[0].tenantId;
      const session: AuthSession = {
        user,
        memberships,
        activeTenantId,
      };

      clearAllImpersonationData();
      setSession(session);
      setLastTenant(activeTenantId);

      const isResident =
        memberships[0].roles.length === 1 &&
        memberships[0].roles.includes('RESIDENT');
      router.push(
        isResident
          ? `/${activeTenantId}/resident/dashboard`
          : `/${activeTenantId}/dashboard`,
      );
    },
  });
};

export const useSignup = () => {
  const router = useRouter();

  return useMutation({
    mutationFn: apiSignup,
    onSuccess: (response) => {
      const { user, memberships } = response;

      if (memberships.length === 0) {
        throw new Error('Error creando membresía');
      }

      const activeTenantId = memberships[0].tenantId;
      const session: AuthSession = {
        user,
        memberships,
        activeTenantId,
      };

      clearAllImpersonationData();
      setSession(session);
      setLastTenant(activeTenantId);

      const isResident =
        memberships[0].roles.length === 1 &&
        memberships[0].roles.includes('RESIDENT');
      router.push(
        isResident
          ? `/${activeTenantId}/resident/dashboard`
          : `/${activeTenantId}/dashboard`,
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
