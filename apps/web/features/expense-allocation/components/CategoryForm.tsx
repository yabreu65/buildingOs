'use client';

import { useState, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { useCreateCategory, useUpdateCategory } from '../index';
import { UnitCategory } from '../services/expense-categories.api';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import Input from '@/shared/components/ui/Input';
import { useToast } from '@/shared/components/ui/Toast';

interface CategoryFormProps {
  buildingId: string;
  category?: UnitCategory;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function CategoryForm({
  buildingId,
  category,
  onSuccess,
  onCancel,
}: CategoryFormProps) {
  const { toast } = useToast();
  const { mutateAsync: create, isPending: isCreating } = useCreateCategory(buildingId);
  const { mutateAsync: update, isPending: isUpdating } = useUpdateCategory(buildingId);

  const [formData, setFormData] = useState({
    name: category?.name || '',
    minM2: category?.minM2 || 0,
    maxM2: category?.maxM2 || null as number | null,
    coefficient: category?.coefficient || 1.0,
  });
  const [error, setError] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!formData.name.trim()) {
      setError('El nombre es requerido');
      return;
    }
    if (formData.minM2 < 0) {
      setError('El m² mínimo debe ser >= 0');
      return;
    }
    if (
      formData.maxM2 !== null &&
      formData.maxM2 !== undefined &&
      formData.maxM2 <= formData.minM2
    ) {
      setError('El m² máximo debe ser > mínimo');
      return;
    }
    if (formData.coefficient <= 0) {
      setError('El coeficiente debe ser > 0');
      return;
    }

    setSubmitting(true);
    try {
      if (category) {
        await update({
          categoryId: category.id,
          data: {
            name: formData.name,
            minM2: formData.minM2,
            maxM2: formData.maxM2,
            coefficient: formData.coefficient,
          },
        });
      } else {
        await create({
          name: formData.name,
          minM2: formData.minM2,
          maxM2: formData.maxM2,
          coefficient: formData.coefficient,
        });
      }
      toast('Categoría guardada', 'success');
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al guardar';
      setError(msg);
      toast('Error al guardar categoría', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const isLoading = submitting || isCreating || isUpdating;

  return (
    <Card className="max-w-md mx-auto">
      <h3 className="text-lg font-semibold mb-4">
        {category ? 'Editar Categoría' : 'Nueva Categoría'}
      </h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Error */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Name */}
        <div>
          <label className="block text-sm font-medium mb-1">Nombre *</label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="ej: Categoría A (40-60m²)"
            disabled={isLoading}
          />
        </div>

        {/* Min m2 */}
        <div>
          <label className="block text-sm font-medium mb-1">m² Mínimo *</label>
          <Input
            type="number"
            value={formData.minM2}
            onChange={(e) => setFormData({ ...formData, minM2: parseFloat(e.target.value) || 0 })}
            placeholder="0"
            disabled={isLoading}
            step="0.1"
          />
        </div>

        {/* Max m2 */}
        <div>
          <label className="block text-sm font-medium mb-1">
            m² Máximo <span className="text-gray-500">(dejar vacío para sin límite)</span>
          </label>
          <Input
            type="number"
            value={formData.maxM2 === null ? '' : formData.maxM2}
            onChange={(e) =>
              setFormData({
                ...formData,
                maxM2: e.target.value === '' ? null : parseFloat(e.target.value) || null,
              })
            }
            placeholder="200"
            disabled={isLoading}
            step="0.1"
          />
        </div>

        {/* Coefficient */}
        <div>
          <label className="block text-sm font-medium mb-1">Coeficiente de Prorrateo *</label>
          <Input
            type="number"
            value={formData.coefficient}
            onChange={(e) =>
              setFormData({ ...formData, coefficient: parseFloat(e.target.value) || 1 })
            }
            placeholder="1.0"
            disabled={isLoading}
            step="0.1"
            min="0.1"
          />
          <p className="text-xs text-gray-500 mt-1">ej: 1.0, 1.5, 2.5</p>
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
