/**
 * useRefreshSession Hook
 *
 * Refreshes the user's session (memberships) from the server without requiring re-login.
 * Useful after creating new tenants or when membership changes occur.
 *
 * Usage:
 *   const { refresh, loading, error } = useRefreshSession();
 *
 *   // Somewhere in a handler:
 *   const result = await refresh();
 *   if (result) {
 *     // Session updated successfully
 *     router.push(`/${result.activeTenantId}/dashboard`);
 *   }
 */

import { useState, useCallback } from 'react';
import { apiClient } from '@/shared/lib/http/client';
import { setSession, getSession } from './session.storage';

interface RefreshSessionResult {
  activeTenantId: string;
  tenantCount: number;
}

export function useRefreshSession() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<RefreshSessionResult | null> => {
    setLoading(true);
    setError(null);

    try {
      // Call GET /auth/me to get updated memberships
      const response = await apiClient<any>({
        path: '/auth/me',
        method: 'GET',
      });

      // Update localStorage with fresh memberships
      if (response.memberships && response.memberships.length > 0) {
        const newSession = {
          user: response.user,
          memberships: response.memberships,
          activeTenantId: response.memberships[0].tenantId,
        };

        setSession(newSession);

        return {
          activeTenantId: newSession.activeTenantId,
          tenantCount: response.memberships.length,
        };
      }

      setError('No memberships found');
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refresh session';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { refresh, loading, error };
}
