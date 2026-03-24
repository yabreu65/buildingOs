'use client';

import { useState } from 'react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { useToast } from '@/shared/components/ui/Toast';
import { X, Loader2 } from 'lucide-react';
import { ChargeType } from '../../services/finance.api';

interface ChargeFormData {
  unitId: string;
  concept: string;
  type: ChargeType;
  amount: number;
  dueDate: string;
}

interface ChargeCreateModalProps {
  buildingId: string;
  onSave: () => Promise<void>;
  onClose: () => void;
  onCreate: (data: ChargeFormData) => Promise<void>;
}

/**
 * ChargeCreateModal: Modal to create a new charge
 */
export function ChargeCreateModal({
  buildingId,
  onSave,
  onClose,
  onCreate,
}: ChargeCreateModalProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<ChargeFormData>({
    unitId: '',
    concept: '',
    type: ChargeType.COMMON_EXPENSE,
    amount: 0,
    dueDate: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.unitId) newErrors.unitId = 'Unidad es requerida';
    if (!formData.concept || formData.concept.length < 2) newErrors.concept = 'Concepto es requerido';
    if (!formData.type) newErrors.type = 'Tipo de cargo es requerido';
    if (formData.amount <= 0) newErrors.amount = 'Monto debe ser positivo';
    if (!formData.dueDate) newErrors.dueDate = 'Fecha de vencimiento es requerida';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      await onCreate(formData);
      toast('Cargo creado', 'success');
      await onSave();
      onClose();
    } catch (error) {
      toast('Error al crear cargo', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <div className="mb-4 flex justify-between items-center">
          <h3 className="text-lg font-semibold">Crear Cargo</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Unidad</label>
            <input
              type="text"
              value={formData.unitId}
              onChange={(e) => setFormData({ ...formData, unitId: e.target.value })}
              placeholder="Ej: 101, A-5, etc."
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {errors.unitId && <p className="text-red-600 text-sm mt-1">{errors.unitId}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Concepto</label>
            <input
              type="text"
              value={formData.concept}
              onChange={(e) => setFormData({ ...formData, concept: e.target.value })}
              placeholder="Ej: Alquiler marzo, Mantenimiento, etc."
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {errors.concept && <p className="text-red-600 text-sm mt-1">{errors.concept}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Tipo de Cargo</label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value as ChargeType })}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value={ChargeType.COMMON_EXPENSE}>Gasto Común</option>
              <option value={ChargeType.EXTRAORDINARY}>Extraordinario</option>
              <option value={ChargeType.FINE}>Multa</option>
              <option value={ChargeType.CREDIT}>Crédito</option>
              <option value={ChargeType.OTHER}>Otro</option>
            </select>
            {errors.type && <p className="text-red-600 text-sm mt-1">{errors.type}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Monto</label>
            <input
              type="number"
              step="0.01"
              value={formData.amount || ''}
              onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
              placeholder="0.00"
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {errors.amount && <p className="text-red-600 text-sm mt-1">{errors.amount}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Fecha de Vencimiento</label>
            <input
              type="date"
              value={formData.dueDate}
              onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {errors.dueDate && <p className="text-red-600 text-sm mt-1">{errors.dueDate}</p>}
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting} className="flex-1">
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Crear Cargo
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
