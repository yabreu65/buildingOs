'use client';

import { useState } from 'react';
import Button from '@/shared/components/ui/Button';

interface CreateUserModalProps {
  onClose: () => void;
  onSubmit: (name: string, email: string, password: string) => Promise<void>;
}

export function CreateUserModal({ onClose, onSubmit }: CreateUserModalProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name || !email || !password) {
      setError('Todos los campos son obligatorios');
      return;
    }

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }

    try {
      setLoading(true);
      await onSubmit(name, email, password);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al crear el usuario';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card rounded-xl border border-border p-6 w-full max-w-md shadow-lg">
        <h2 className="text-2xl font-bold text-foreground mb-4">Crear Super Admin</h2>

        {error && (
          <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Nombre</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Juan Pérez"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="juan@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Mínimo 8 caracteres"
            />
          </div>

          <div className="flex gap-3 justify-end pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg hover:bg-muted transition-colors text-foreground"
            >
              Cancelar
            </button>
            <Button disabled={loading} onClick={handleSubmit}>
              {loading ? 'Creando...' : 'Crear'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
