'use client';

/**
 * SessionRefreshPrompt Component
 *
 * Shows a prompt when user needs to refresh their session after membership changes.
 * This happens when:
 * - A new tenant was created (via demo:tenants script or signup)
 * - User was added to a new tenant
 * - Membership permissions changed
 *
 * Usage: Add to layout so it's always available:
 *   <SessionRefreshPrompt />
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRefreshSession } from '@/features/auth/useRefreshSession';
import Card from '@/shared/components/ui/Card';
import Button from '@/shared/components/ui/Button';

export default function SessionRefreshPrompt() {
  const router = useRouter();
  const { refresh, loading, error } = useRefreshSession();
  const [showPrompt, setShowPrompt] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('session_refresh_needed') === 'true',
  );

  const handleRefresh = async () => {
    const result = await refresh();
    if (result) {
      setShowPrompt(false);
      // Redirect to the resolved landing route for the refreshed session
      router.push(result.landingPath);
    }
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm">
      <Card className="border-l-4 border-l-blue-500 shadow-lg">
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-foreground mb-1">
              📋 Sesión Actualizada
            </h3>
            <p className="text-sm text-muted-foreground">
              Detectamos cambios en tus memberships. Actualiza tu sesión para acceder a nuevos tenants.
            </p>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 p-2 rounded">
              Error: {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              onClick={handleRefresh}
              disabled={loading}
              className="flex-1"
            >
              {loading ? 'Actualizando...' : 'Actualizar Ahora'}
            </Button>
            <Button
              onClick={() => setShowPrompt(false)}
              variant="secondary"
              disabled={loading}
            >
              Descartar
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
