'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiLogin, apiSignup, type LoginPayload, type SignupPayload } from './auth.service';
import { setToken, setSession, setLastTenant, clearAuth } from './session.storage';
import type { AuthSession } from './auth.types';

export function useLogin() {
  const router = useRouter();

  return useMutation({
    mutationFn: apiLogin,
    onSuccess: (response) => {
      const { accessToken, user, memberships } = response;

      if (memberships.length === 0) {
        throw new Error('No tienes membresías válidas');
      }

      const activeTenantId = memberships[0].tenantId;
      const session: AuthSession = {
        user,
        memberships,
        activeTenantId,
      };

      setToken(accessToken);
      setSession(session);
      setLastTenant(activeTenantId);

      router.push(`/${activeTenantId}/dashboard`);
    },
  });
}

export function useSignup() {
  const router = useRouter();

  return useMutation({
    mutationFn: apiSignup,
    onSuccess: (response) => {
      const { accessToken, user, memberships } = response;

      if (memberships.length === 0) {
        throw new Error('Error creando membresía');
      }

      const activeTenantId = memberships[0].tenantId;
      const session: AuthSession = {
        user,
        memberships,
        activeTenantId,
      };

      setToken(accessToken);
      setSession(session);
      setLastTenant(activeTenantId);

      router.push(`/${activeTenantId}/dashboard`);
    },
  });
}

export function useLogout() {
  const router = useRouter();

  return () => {
    clearAuth();
    router.push('/login');
  };
}
