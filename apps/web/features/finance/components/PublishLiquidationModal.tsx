'use client';

import { useState } from 'react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { X, Loader2, Send } from 'lucide-react';

interface PublishLiquidationModalProps {
  liquidationId: string;
  onPublish: (dueDate: string) => Promise<void>;
  isLoading?: boolean;
}

export default function PublishLiquidationModal({
  liquidationId,
  onPublish,
  isLoading,
}: PublishLiquidationModalProps) {
  const [open, setOpen] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState('');

  const handlePublish = async () => {
    if (!dueDate) {
      setError('La fecha de vencimiento es requerida');
      return;
    }

    try {
      await onPublish(new Date(dueDate).toISOString());
      setOpen(false);
      setDueDate('');
      setError('');
    } catch (err: any) {
      setError(err.message || 'Error al publicar');
    }
  };

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        disabled={isLoading}
        className="flex items-center gap-1"
      >
        {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
        <Send className="w-3 h-3" />
        Publicar
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-0">
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="font-semibold">Publicar Liquidación</h3>
          <button
            onClick={() => setOpen(false)}
            disabled={isLoading}
            className="text-gray-500 hover:text-gray-700 disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-600">
            Confirme la fecha de vencimiento para los cargos de expensas
          </p>

          <div>
            <label htmlFor="dueDate" className="block text-sm font-medium mb-1">
              Fecha de Vencimiento
            </label>
            <input
              id="dueDate"
              type="date"
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
                setError('');
              }}
              disabled={isLoading}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 pt-2">
            <Button
              onClick={handlePublish}
              disabled={!dueDate || isLoading}
              className="flex-1 flex items-center justify-center gap-1"
            >
              {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
              Publicar
            </Button>
            <Button
              onClick={() => setOpen(false)}
              disabled={isLoading}
              variant="secondary"
              className="flex-1"
            >
              Cancelar
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
