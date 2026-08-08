'use client';

import { useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import Card from '@/shared/components/ui/Card';
import Button from '@/shared/components/ui/Button';
import Input from '@/shared/components/ui/Input';
import Select from '@/shared/components/ui/Select';
import { toCents, formatCurrency } from '@/shared/lib/format/money';
import type { Building } from '@/features/units/units.types';
import type {
  CreateTenantRecurringExpenseData,
  RecurringExpense,
  RecurringExpenseAllocationInput,
  RecurringExpenseAllocationMode,
} from '../services/expense-ledger.api';

interface CategoryOption {
  id: string;
  name: string;
}

interface TenantRecurringExpenseModalProps {
  isOpen: boolean;
  categoryOptions: CategoryOption[];
  buildings: Building[];
  initialValue?: RecurringExpense;
  onClose: () => void;
  onSubmit: (data: CreateTenantRecurringExpenseData) => Promise<void>;
  isSubmitting?: boolean;
}

const MODE_OPTIONS: Array<{ value: RecurringExpenseAllocationMode; label: string }> = [
  { value: 'MANUAL', label: 'Distribución manual' },
  { value: 'EQUAL_SHARE', label: 'Partes iguales' },
  { value: 'BUILDING_TOTAL_M2', label: 'Según m² de los edificios' },
];

const FREQUENCY_OPTIONS: Array<{ value: 'MONTHLY' | 'QUARTERLY' | 'YEARLY'; label: string }> = [
  { value: 'MONTHLY', label: 'Mensual' },
  { value: 'QUARTERLY', label: 'Trimestral' },
  { value: 'YEARLY', label: 'Anual' },
];

function allocationModeLabel(mode: RecurringExpenseAllocationMode): string {
  return MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}

export function TenantRecurringExpenseModal({
  isOpen,
  categoryOptions,
  buildings,
  initialValue,
  onClose,
  onSubmit,
  isSubmitting,
}: TenantRecurringExpenseModalProps) {
  const isEditMode = !!initialValue;

  const [categoryId, setCategoryId] = useState(initialValue?.categoryId || '');
  const [concept, setConcept] = useState(initialValue?.concept || '');
  const [currency, setCurrency] = useState(initialValue?.currency || 'ARS');
  const [frequency, setFrequency] = useState<'MONTHLY' | 'QUARTERLY' | 'YEARLY'>(
    (initialValue?.frequency as 'MONTHLY' | 'QUARTERLY' | 'YEARLY') || 'MONTHLY',
  );
  const [allocationMode, setAllocationMode] = useState<RecurringExpenseAllocationMode>(
    (initialValue?.allocationMode as RecurringExpenseAllocationMode) || 'EQUAL_SHARE',
  );
  const [amountInput, setAmountInput] = useState(
    initialValue ? String(initialValue.amount / 100) : '',
  );
  const [percentages, setPercentages] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const amountMinor = useMemo(() => {
    const amount = Number(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      return 0;
    }
    return toCents(amount);
  }, [amountInput]);

  const totalPercentage = useMemo(() => {
    return Object.values(percentages).reduce((sum, value) => {
      const parsed = Number(value);
      return sum + (Number.isFinite(parsed) ? parsed : 0);
    }, 0);
  }, [percentages]);

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
      setError('Monto inválido');
      return;
    }

    if (isEditMode) {
      setError('');
      await onSubmit({
        scopeType: 'TENANT_SHARED',
        allocationMode: initialValue?.allocationMode || 'EQUAL_SHARE',
        categoryId,
        amount: amountMinor,
        currency,
        concept: concept.trim(),
        frequency,
      });
      return;
    }

    if (buildings.length === 0) {
      setError('El conjunto no tiene edificios para crear una regla recurrente');
      return;
    }

    let allocations: RecurringExpenseAllocationInput[] | undefined;
    if (allocationMode === 'MANUAL') {
      const parsed: Array<{ buildingId: string; percentage: number }> = buildings.map(
        (building) => ({
          buildingId: building.id,
          percentage: Number(percentages[building.id] ?? 0),
        }),
      );

      const invalid = parsed.some(
        (allocation) =>
          !Number.isInteger(allocation.percentage) ||
          allocation.percentage < 0 ||
          allocation.percentage > 100,
      );
      if (invalid) {
        setError('Los porcentajes deben ser números enteros entre 0 y 100');
        return;
      }

      if (totalPercentage !== 100) {
        setError(`La suma de los porcentajes debe ser exactamente 100% (actual: ${totalPercentage}%)`);
        return;
      }

      allocations = parsed.filter((allocation) => allocation.percentage > 0);
      if (allocations.length === 0) {
        setError('Debe existir al menos una allocation con porcentaje mayor a 0');
        return;
      }
    }

    setError('');
    await onSubmit({
      scopeType: 'TENANT_SHARED',
      allocationMode,
      categoryId,
      amount: amountMinor,
      currency,
      concept: concept.trim(),
      frequency,
      allocations,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg p-0">
        <div className="flex items-center justify-between border-b p-4">
          <h3 className="text-lg font-semibold">
            {isEditMode ? 'Editar regla recurrente' : 'Nueva regla recurrente'}
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
              aria-label="Rubro"
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
            aria-label="Concepto"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            disabled={isSubmitting}
            placeholder="Ej. Abono de limpieza mensual"
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label="Monto"
              aria-label="Monto"
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
                aria-label="Moneda"
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
              aria-label="Frecuencia"
              value={frequency}
              onChange={(e) =>
                setFrequency(e.target.value as 'MONTHLY' | 'QUARTERLY' | 'YEARLY')
              }
              disabled={isSubmitting || isEditMode}
            >
              {FREQUENCY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          {!isEditMode ? (
            <div className="space-y-1">
              <label className="text-sm font-medium">Método de distribución</label>
              <Select
                aria-label="Método de distribución"
                value={allocationMode}
                onChange={(e) =>
                  setAllocationMode(e.target.value as RecurringExpenseAllocationMode)
                }
                disabled={isSubmitting}
              >
                {MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <div className="space-y-1">
              <label className="text-sm font-medium">Método de distribución</label>
              <p className="text-sm text-muted-foreground">
                {initialValue?.allocationMode
                  ? allocationModeLabel(initialValue.allocationMode)
                  : 'Sin especificar'}
              </p>
            </div>
          )}

          {!isEditMode && allocationMode === 'MANUAL' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Porcentajes por edificio</p>
                <p
                  className={`text-sm font-medium ${
                    totalPercentage === 100 ? 'text-green-600' : 'text-muted-foreground'
                  }`}
                >
                  Total: {totalPercentage}%
                </p>
              </div>

              {buildings.length === 0 ? (
                <p className="text-xs text-amber-600">
                  El conjunto no tiene edificios. Agrega edificios antes de crear una regla con
                  distribución manual.
                </p>
              ) : (
                <div className="space-y-2">
                  {buildings.map((building) => (
                    <div
                      key={building.id}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="text-sm">{building.name}</span>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={percentages[building.id] ?? ''}
                        onChange={(e) =>
                          setPercentages((prev) => ({
                            ...prev,
                            [building.id]: e.target.value,
                          }))
                        }
                        disabled={isSubmitting}
                        className="w-24"
                        aria-label={`Porcentaje para ${building.name}`}
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!isEditMode && allocationMode === 'EQUAL_SHARE' && (
            <p className="text-xs text-muted-foreground">
              El gasto se distribuirá en partes iguales entre los edificios existentes al momento
              de ejecutar la regla.
            </p>
          )}

          {!isEditMode && allocationMode === 'BUILDING_TOTAL_M2' && (
            <p className="text-xs text-muted-foreground">
              El gasto se distribuirá proporcionalmente según los m² totales de cada edificio al
              momento de ejecutar la regla.
            </p>
          )}

          {!isEditMode && amountMinor > 0 && (
            <p className="text-xs text-muted-foreground">
              Se generarán gastos por {formatCurrency(amountMinor, currency)} según la
              frecuencia.
            </p>
          )}

          {isEditMode ? (
            <p className="text-xs text-muted-foreground">
              En edición solo se puede actualizar concepto y monto. El método de distribución no
              se puede modificar.
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
