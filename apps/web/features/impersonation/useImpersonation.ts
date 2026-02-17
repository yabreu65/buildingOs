'use client';

import { useRouter } from 'next/navigation';
import { useBoStorageTick } from '@/shared/lib/storage/useBoStorage';
import { apiClient } from '@/shared/lib/http/client';
import {
  getImpersonationMetadata,
  setImpersonationMetadata,
  getTokenBackup,
  setTokenBackup,
  getSessionBackup,
  setSessionBackup,
  clearAllImpersonationData,
  isImpersonationExpired,
} from './impersonation.storage';
import * as sessionStorage from '../auth/session.storage';
import type { ImpersonationMetadata } from './impersonation.types';
import type { AuthSession, Role } from '../auth/auth.types';

interface UseImpersonationReturn {
  isImpersonating: boolean;
  metadata: ImpersonationMetadata | null;
  isExpired: boolean;
  startImpersonation: (tenantId: string) => Promise<void>;
  endImpersonation: () => Promise<void>;
}

export function useImpersonation(): UseImpersonationReturn {
  useBoStorageTick(); // Re-render on storage changes
  const router = useRouter();

  const metadata = getImpersonationMetadata();
  const isExpired = isImpersonationExpired();
  const isImpersonating = !!metadata && !isExpired;

  const startImpersonation = async (tenantId: string): Promise<void> => {
    try {
      // 1. POST /api/super-admin/impersonation/start
      const response = await apiClient<
        {
          impersonationToken: string;
          expiresAt: string;
          tenant: { id: string; name: string };
        },
        { tenantId: string }
      >({
        path: '/api/super-admin/impersonation/start',
        method: 'POST',
        body: { tenantId },
      });

      // 2. Backup current token + session
      const currentToken = sessionStorage.getToken();
      const currentSession = sessionStorage.getSession();

      if (currentToken) {
        setTokenBackup(currentToken);
      }
      if (currentSession) {
        setSessionBackup(currentSession);
      }

      // 3. Swap token → impersonationToken
      sessionStorage.setToken(response.impersonationToken);

      // 4. Update session with synthetic membership
      if (currentSession) {
        const impersonatedSession: AuthSession = {
          ...currentSession,
          activeTenantId: tenantId,
          memberships: [
            {
              tenantId,
              roles: ['TENANT_ADMIN'] as Role[],
            },
          ],
        };
        sessionStorage.setSession(impersonatedSession);
      }

      // 5. Save impersonation metadata
      setImpersonationMetadata({
        tenantId: response.tenant.id,
        tenantName: response.tenant.name,
        expiresAt: response.expiresAt,
        actorUserId: currentSession?.memberships[0]?.tenantId || 'unknown',
      });

      // 6. Navigate to tenant dashboard
      router.push(`/${tenantId}/dashboard`);
    } catch (error) {
      console.error('Failed to start impersonation:', error);
      throw error;
    }
  };

  const endImpersonation = async (): Promise<void> => {
    try {
      // 1. POST /api/super-admin/impersonation/end (with impersonation token)
      await apiClient<{ ok: boolean }>({
        path: '/api/super-admin/impersonation/end',
        method: 'POST',
      });
    } catch (error) {
      console.error('Failed to end impersonation (audit error, continuing):', error);
      // Continue even if audit fails - client-side cleanup still happens
    }

    try {
      // 2. Restore backup token + session
      const backupToken = getTokenBackup();
      const backupSession = getSessionBackup();

      if (backupToken) {
        sessionStorage.setToken(backupToken);
      }
      if (backupSession) {
        sessionStorage.setSession(backupSession);
      }

      // 3. Clear all impersonation storage
      clearAllImpersonationData();

      // 4. Navigate to /super-admin
      router.push('/super-admin');
    } catch (error) {
      console.error('Failed to restore SA session:', error);
      // Last resort: clear everything and go to login
      sessionStorage.clearAuth();
      router.push('/login');
    }
  };

  return {
    isImpersonating,
    metadata,
    isExpired,
    startImpersonation,
    endImpersonation,
  };
}
