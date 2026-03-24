'use client';

import { useState } from 'react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { X, Loader2 } from 'lucide-react';

interface PaymentApproveModalProps {
  paymentId: string;
  onConfirm: (paidAt?: string) => Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
}

/**
 * PaymentApproveModal: Modal to approve a payment with optional payment date
 */
export function PaymentApproveModal({
  paymentId,
  onConfirm,
  onCancel,
  isSubmitting = false,
}: PaymentApproveModalProps) {
  const [paidAt, setPaidAt] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onConfirm(paidAt || undefined);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <div className="mb-4 flex justify-between items-center">
          <h3 className="text-lg font-semibold">Aprobar Pago</h3>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="paidAt" className="block text-sm font-medium mb-1">
              Fecha de Pago (Opcional)
            </label>
            <input
              id="paidAt"
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-xs text-gray-500 mt-1">
              Si no especificas una fecha, se usará la fecha actual
            </p>
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={onCancel}
              disabled={isSubmitting}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting} className="flex-1">
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirmar Aprobación
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
