'use client';

import { useState } from 'react';
import Button from '@/shared/components/ui/Button';
import { PlatformUser } from '../services/platform-users.api';

interface DeleteUserModalProps {
  user: PlatformUser;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteUserModal({ user, onClose, onConfirm }: DeleteUserModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    try {
      setLoading(true);
      await onConfirm();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al eliminar el usuario';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-xl border border-border p-6 w-full max-w-md shadow-lg">
        <h2 className="text-2xl font-bold text-foreground mb-2">Eliminar usuario global</h2>
        <p className="text-muted-foreground mb-4">
          ¿Quieres revocar el acceso de <strong>{user.name}</strong> ({user.email})? Esta acción es irreversible.
        </p>

        {error && (
          <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg hover:bg-muted transition-colors text-foreground"
          >
            Cancelar
          </button>
          <Button
            type="button"
            disabled={loading}
            onClick={handleConfirm}
            className="bg-destructive hover:bg-destructive/90"
          >
            {loading ? 'Eliminando...' : 'Eliminar acceso'}
          </Button>
        </div>
      </div>
    </div>
  );
}
