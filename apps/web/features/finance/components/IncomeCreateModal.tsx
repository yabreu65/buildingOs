'use client';

import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import Button from '@/shared/components/ui/Button';
import { useToast } from '@/shared/components/ui/Toast';
import {
  useCreateIncome,
  useExpenseLedgerCategories,
} from '../hooks/useExpenseLedger';

interface IncomeCreateModalProps {
  tenantId: string;
  buildingId?: string;
  period: string;
  onClose: () => void;
  onCreated: () => void;
}

const CURRENCIES = ['ARS', 'VES', 'USD'];

export function IncomeCreateModal({
  tenantId,
  buildingId,
  period,
  onClose,
  onCreated,
}: IncomeCreateModalProps) {
  const { toast } = useToast();
  const { data: allCategories = [] } = useExpenseLedgerCategories(tenantId);
  const createMutation = useCreateIncome(tenantId);

  // Filtrar solo categorías de INGRESOS
  const categories = allCategories.filter((c) => c.movementType === 'INCOME');

  const [form, setForm] = useState({
    categoryId: '',
    amountMinor: '',
    currencyCode: 'ARS',
    receivedDate: new Date().toISOString().split('T')[0] ?? '',
    description: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const amountMinor = Math.round(parseFloat(form.amountMinor) * 100);
    if (isNaN(amountMinor) || amountMinor <= 0) {
      toast('El monto debe ser un número positivo', 'error');
      return;
    }

    if (!form.categoryId) {
      toast('Debes seleccionar un rubro de ingreso', 'error');
      return;
    }

    try {
      await createMutation.mutateAsync({
        buildingId: buildingId || undefined,
        period,
        categoryId: form.categoryId,
        amountMinor,
        currencyCode: form.currencyCode,
        receivedDate: form.receivedDate,
        description: form.description || undefined,
      });

      toast('Ingreso registrado', 'success');
      onCreated();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar el ingreso';
      toast(msg, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Registrar Ingreso</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Rubro <span className="text-red-500">*</span>
            </label>
            <select
              required
              value={form.categoryId}
              onChange={(e) =>
                setForm((f) => ({ ...f, categoryId: e.target.value }))
              }
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Seleccioná un rubro de ingreso</option>
              {categories
                .filter((c) => c.isActive)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">
                Monto <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                required
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={form.amountMinor}
                onChange={(e) =>
                  setForm((f) => ({ ...f, amountMinor: e.target.value }))
                }
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Moneda</label>
              <select
                value={form.currencyCode}
                onChange={(e) =>
                  setForm((f) => ({ ...f, currencyCode: e.target.value }))
                }
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Fecha de Recepción <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              required
              value={form.receivedDate}
              onChange={(e) =>
                setForm((f) => ({ ...f, receivedDate: e.target.value }))
              }
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Descripción (opcional)
            </label>
            <textarea
              placeholder="Ej: Cuota extraordinaria pagada por..."
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              rows={3}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              Registrar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
