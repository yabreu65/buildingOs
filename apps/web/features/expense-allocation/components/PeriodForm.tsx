'use client';

import { useState, useEffect } from 'react';
import { AlertCircle, Calendar } from 'lucide-react';
import { useCreatePeriod } from '../index';
import { ExpensePeriod } from '../services/expense-periods.api';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import Input from '@/shared/components/ui/Input';
import { useToast } from '@/shared/components/ui/Toast';

interface PeriodFormProps {
  tenantId: string;
  buildingId: string;
  period?: ExpensePeriod;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function PeriodForm({ tenantId, buildingId, period, onSuccess, onCancel }: PeriodFormProps) {
  const { toast } = useToast();
  const { mutateAsync: create, isPending: isCreating } = useCreatePeriod(tenantId, buildingId);

  const now = new Date();
  const defaultYear = now.getFullYear();
  const defaultMonth = now.getMonth() + 1;

  const [formData, setFormData] = useState({
    year: period?.year || defaultYear,
    month: period?.month || defaultMonth,
    totalToAllocate: period ? period.totalToAllocate / 100 : 0,
    currency: period?.currency || 'ARS',
    dueDate: period?.dueDate ? new Date(period.dueDate).toISOString().split('T')[0] : '',
    concept: period?.concept || '',
  });
  const [error, setError] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (formData.year < 2000 || formData.year > 2100) {
      setError('Año inválido');
      return;
    }
    if (formData.month < 1 || formData.month > 12) {
      setError('Mes inválido (1-12)');
      return;
    }
    if (formData.totalToAllocate <= 0) {
      setError('El monto debe ser mayor a 0');
      return;
    }
    if (!formData.dueDate) {
      setError('La fecha de vencimiento es requerida');
      return;
    }
    if (!formData.concept.trim()) {
      setError('El concepto es requerido');
      return;
    }

    setSubmitting(true);
    try {
      await create({
        year: formData.year,
        month: formData.month,
        totalToAllocate: Math.floor(formData.totalToAllocate * 100), // Convert to cents
        currency: formData.currency,
        dueDate: new Date(formData.dueDate).toISOString(),
        concept: formData.concept,
      });
      toast('Período creado', 'success');
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al guardar período';
      setError(msg);
      toast('Error al crear período', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const isLoading = submitting || isCreating;
  const monthNames = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ];

  return (
    <Card className="max-w-md mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="w-5 h-5 text-blue-600" />
        <h3 className="text-lg font-semibold">{period ? 'Editar Período' : 'Nuevo Período'}</h3>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Error */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Year and Month */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Año *</label>
            <Input
              type="number"
              value={formData.year}
              onChange={(e) => setFormData({ ...formData, year: parseInt(e.target.value) || 2026 })}
              disabled={isLoading}
              min="2000"
              max="2100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Mes *</label>
            <select
              value={formData.month}
              onChange={(e) =>
                setFormData({ ...formData, month: parseInt(e.target.value) || 1 })
              }
              disabled={isLoading}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            >
              {monthNames.map((name, idx) => (
                <option key={idx} value={idx + 1}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Total to Allocate */}
        <div>
          <label className="block text-sm font-medium mb-1">Monto Total *</label>
          <div className="flex items-center gap-2">
            <span className="text-gray-600">$</span>
            <Input
              type="number"
              value={formData.totalToAllocate}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  totalToAllocate: parseFloat(e.target.value) || 0,
                })
              }
              placeholder="15000"
              disabled={isLoading}
              step="0.01"
              min="0.01"
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">Monto a distribuir entre unidades</p>
        </div>

        {/* Due Date */}
        <div>
          <label className="block text-sm font-medium mb-1">Fecha de Vencimiento *</label>
          <Input
            type="date"
            value={formData.dueDate}
            onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
            disabled={isLoading}
          />
        </div>

        {/* Concept */}
        <div>
          <label className="block text-sm font-medium mb-1">Concepto *</label>
          <Input
            value={formData.concept}
            onChange={(e) => setFormData({ ...formData, concept: e.target.value })}
            placeholder="ej: Expensas Comunes - Enero 2026"
            disabled={isLoading}
          />
          <p className="text-xs text-gray-500 mt-1">Descripción del gasto</p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-4">
          <Button variant="secondary" onClick={onCancel} disabled={isLoading} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" disabled={isLoading} className="flex-1">
            {isLoading ? 'Guardando...' : 'Guardar'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
