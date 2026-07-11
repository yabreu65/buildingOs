'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { X, Loader2, Plus } from 'lucide-react';
import { useCreateLiquidationDraft } from '../hooks/useExpenseLedger';

interface Building {
  readonly id: string;
  readonly name: string;
}

interface CreateLiquidationModalProps {
  readonly tenantId: string;
  readonly buildings: readonly Building[];
  readonly onSuccess?: () => void;
}

const supportedCurrencies = ['ARS', 'USD', 'UYU'] as const;
type SupportedCurrency = (typeof supportedCurrencies)[number];

function isSupportedCurrency(value: string): value is SupportedCurrency {
  return supportedCurrencies.some((currency) => currency === value);
}

function isValidPeriod(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function CreateLiquidationModal({
  tenantId,
  buildings,
  onSuccess,
}: CreateLiquidationModalProps) {
  const triggerButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const buildingSelectRef = useRef<HTMLSelectElement>(null);
  const wasOpenRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [buildingId, setBuildingId] = useState('');
  const [period, setPeriod] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('ARS');
  const [error, setError] = useState('');

  const createMutation = useCreateLiquidationDraft(tenantId);

  useEffect(() => {
    if (open) {
      buildingSelectRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      triggerButtonRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open]);

  const handleCreate = async () => {
    const normalizedBuildingId = buildingId.trim();
    const normalizedPeriod = period.trim();

    if (!normalizedBuildingId || !normalizedPeriod) {
      setError('Todos los campos son requeridos');
      return;
    }

    if (!buildings.some((building) => building.id === normalizedBuildingId)) {
      setError('El edificio seleccionado no es válido');
      return;
    }

    if (!isValidPeriod(normalizedPeriod)) {
      setError('El período debe tener formato YYYY-MM');
      return;
    }

    if (!isSupportedCurrency(baseCurrency)) {
      setError('La moneda base no es válida');
      return;
    }

    try {
      await createMutation.mutateAsync({
        buildingId: normalizedBuildingId,
        period: normalizedPeriod,
        baseCurrency,
      });
      setOpen(false);
      setBuildingId('');
      setPeriod('');
      setBaseCurrency('ARS');
      setError('');
      onSuccess?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al crear la liquidación');
    }
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setOpen(false);
      return;
    }

    if (event.key === 'Tab') {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );

      if (!focusable || focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement as HTMLElement | null;

      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  if (!open) {
    return (
      <button
        ref={triggerButtonRef}
        onClick={() => setOpen(true)}
        disabled={buildings.length === 0 || createMutation.isPending}
        className="inline-flex items-center justify-center rounded-md font-medium transition disabled:opacity-50 disabled:cursor-not-allowed bg-primary text-primary-foreground hover:opacity-90 px-3 py-2 text-sm flex items-center gap-1"
      >
        <Plus className="w-4 h-4" />
        Nueva Liquidación
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-liquidation-title"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <Card className="w-full max-w-md p-0 outline-none">
          <div className="p-4 border-b flex justify-between items-center">
            <h3 id="create-liquidation-title" className="font-semibold">
              Crear Liquidación
            </h3>
            <button
              onClick={() => setOpen(false)}
              disabled={createMutation.isPending}
              className="text-gray-500 hover:text-gray-700 disabled:opacity-50"
              aria-label="Cerrar diálogo"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            <p className="text-sm text-gray-600">
              Configure los parámetros para generar una nueva liquidación de expensas
            </p>

            {/* Building Selection */}
            <div>
              <label htmlFor="building" className="block text-sm font-medium mb-1">
                Edificio
              </label>
              <select
                id="building"
                ref={buildingSelectRef}
                value={buildingId}
                onChange={(e) => {
                  setBuildingId(e.target.value);
                  setError('');
                }}
                disabled={createMutation.isPending}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              >
                <option value="">Seleccionar edificio</option>
                {buildings.map((building) => (
                  <option key={building.id} value={building.id}>
                    {building.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Period Selection */}
            <div>
              <label htmlFor="period" className="block text-sm font-medium mb-1">
                Período (YYYY-MM)
              </label>
              <input
                id="period"
                type="month"
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  setError('');
                }}
                disabled={createMutation.isPending}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              />
              <p className="mt-1 text-xs text-gray-500">
                Seleccione el mes para el cual desea crear la liquidación
              </p>
            </div>

            {/* Currency Selection */}
            <div>
              <label htmlFor="currency" className="block text-sm font-medium mb-1">
                Moneda Base
              </label>
              <select
                id="currency"
                value={baseCurrency}
                onChange={(e) => setBaseCurrency(e.target.value)}
                disabled={createMutation.isPending}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              >
                <option value="ARS">ARS - Peso Argentino</option>
                <option value="USD">USD - Dólar</option>
                <option value="UYU">UYU - Peso Uruguayo</option>
              </select>
            </div>

            {error && (
              <p className="text-sm text-red-600" role="alert" aria-live="polite">
                {error}
              </p>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleCreate}
                disabled={createMutation.isPending}
                className="flex-1 flex items-center justify-center gap-1"
              >
                {createMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                {createMutation.isPending ? 'Creando...' : 'Crear Liquidación'}
              </Button>
              <Button
                onClick={() => setOpen(false)}
                disabled={createMutation.isPending}
                variant="secondary"
                className="flex-1"
              >
                Cancelar
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
