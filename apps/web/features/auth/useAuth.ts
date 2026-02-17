'use client';

import { useEffect, useState } from 'react';
import { getSession } from './session.storage';
import { useBoStorageTick } from '@/shared/lib/storage/useBoStorage';
import type { AuthSession, Role } from './auth.types';

interface CurrentUser {
  id: string;
  email: string;
  name: string;
  roles?: Role[];
}

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface UseAuthReturn {
  currentUser: CurrentUser | null;
  session: AuthSession | null;
  status: AuthStatus;
  /** @deprecated Use status instead */
  isLoading: boolean;
}

/**
 * Hook to access current auth user and session from localStorage
 * Re-renders when storage changes (via useBoStorageTick)
 *
 * Status values:
 * - 'loading': Auth state still being determined (first render)
 * - 'authenticated': User has valid session
 * - 'unauthenticated': No session or session invalid
 */
export function useAuth(): UseAuthReturn {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  // Re-render when localStorage changes
  useBoStorageTick();

  useEffect(() => {
    const authSession = getSession();
    setSession(authSession);

    if (authSession?.user) {
      // Check if user is SUPER_ADMIN globally (in ANY membership)
      const isSuperAdmin = authSession.memberships.some((m) =>
        m.roles.includes('SUPER_ADMIN')
      );

      // If SUPER_ADMIN, return that; otherwise get roles from active tenant
      const roles = isSuperAdmin
        ? ['SUPER_ADMIN' as const]
        : authSession.memberships.find((m) => m.tenantId === authSession.activeTenantId)
            ?.roles;

      const user: CurrentUser = {
        id: authSession.user.id,
        email: authSession.user.email,
        name: authSession.user.name,
        roles,
      };
      setCurrentUser(user);
      setStatus('authenticated');
    } else {
      setCurrentUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  return {
    currentUser,
    session,
    status,
    isLoading: status === 'loading', // Backward compatibility
  };
}
