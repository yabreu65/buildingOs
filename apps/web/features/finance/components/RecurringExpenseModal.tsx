'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import Card from '@/shared/components/ui/Card';
import Button from '@/shared/components/ui/Button';
import Input from '@/shared/components/ui/Input';
import Select from '@/shared/components/ui/Select';
import { toCents, formatCurrency } from '@/shared/lib/format/money';
import type {
  CreateRecurringExpenseData,
  RecurringExpense,
} from '../services/expense-ledger.api';

interface CategoryOption {
  id: string;
  name: string;
}

interface RecurringExpenseModalProps {
  isOpen: boolean;
  categoryOptions: CategoryOption[];
  initialValue?: RecurringExpense;
  onClose: () => void;
  onSubmit: (data: CreateRecurringExpenseData) => Promise<void>;
  isSubmitting?: boolean;
}

export function RecurringExpenseModal({
  isOpen,
  categoryOptions,
  initialValue,
  onClose,
  onSubmit,
  isSubmitting,
}: RecurringExpenseModalProps) {
  const isEditMode = !!initialValue;
  const [categoryId, setCategoryId] = useState(initialValue?.categoryId || '');
  const [concept, setConcept] = useState(initialValue?.concept || '');
  const [currency, setCurrency] = useState(initialValue?.currency || 'ARS');
  const [frequency, setFrequency] = useState<'MONTHLY' | 'QUARTERLY' | 'YEARLY'>(
    (initialValue?.frequency as 'MONTHLY' | 'QUARTERLY' | 'YEARLY') || 'MONTHLY',
  );
  const [amountInput, setAmountInput] = useState(
    initialValue ? String(initialValue.amount / 100) : '',
  );
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setCategoryId(initialValue?.categoryId || '');
    setConcept(initialValue?.concept || '');
    setCurrency(initialValue?.currency || 'ARS');
    setFrequency(
      (initialValue?.frequency as 'MONTHLY' | 'QUARTERLY' | 'YEARLY') || 'MONTHLY',
    );
    setAmountInput(initialValue ? String(initialValue.amount / 100) : '');
    setError('');
  }, [initialValue, isOpen]);

  const amountMinor = useMemo(() => {
    const amount = Number(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      return 0;
    }
    return toCents(amount);
  }, [amountInput]);

  if (!isOpen) {
    return null;
  }

  const handleSave = async () => {
    if (!categoryId) {
      setError('Selecciona un rubro');
      return;
    }
    if (!concept.trim()) {
      setError('El concepto es requerido');
      return;
    }
    if (!amountMinor) {
      setError('Monto invalido');
      return;
    }

    setError('');
    await onSubmit({
      categoryId,
      concept: concept.trim(),
      amount: amountMinor,
      currency,
      frequency,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b p-4">
          <h3 className="text-lg font-semibold">
            {initialValue ? 'Editar gasto recurrente' : 'Nuevo gasto recurrente'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Rubro</label>
            <Select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              disabled={isSubmitting || isEditMode}
            >
              <option value="">Selecciona un rubro</option>
              {categoryOptions.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </Select>
          </div>

          <Input
            label="Concepto"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            disabled={isSubmitting}
            placeholder="Ej. Abono de limpieza mensual"
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label="Monto"
              type="number"
              step="0.01"
              min="0"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              disabled={isSubmitting}
              placeholder="0.00"
            />

            <div className="space-y-1">
              <label className="text-sm font-medium">Moneda</label>
              <Select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                disabled={isSubmitting || isEditMode}
              >
                <option value="ARS">ARS</option>
                <option value="USD">USD</option>
                <option value="VES">VES</option>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Frecuencia</label>
            <Select
              value={frequency}
              onChange={(e) =>
                setFrequency(e.target.value as 'MONTHLY' | 'QUARTERLY' | 'YEARLY')
              }
              disabled={isSubmitting || isEditMode}
            >
              <option value="MONTHLY">Mensual</option>
              <option value="QUARTERLY">Trimestral</option>
              <option value="YEARLY">Anual</option>
            </Select>
          </div>

          {amountMinor > 0 && (
            <p className="text-xs text-muted-foreground">
              Se generaran gastos por {formatCurrency(amountMinor, currency)} segun la frecuencia.
            </p>
          )}

          {isEditMode ? (
            <p className="text-xs text-muted-foreground">
              En edicion solo se puede actualizar concepto y monto por restricciones del backend.
            </p>
          ) : null}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              className="flex-1"
              onClick={() => void handleSave()}
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
