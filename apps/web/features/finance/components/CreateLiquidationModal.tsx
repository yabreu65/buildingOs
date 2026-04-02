'use client';

import { useState } from 'react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { X, Loader2, Plus } from 'lucide-react';
import { useCreateLiquidation } from '../hooks/useLiquidation';

interface Building {
  id: string;
  name: string;
}

interface CreateLiquidationModalProps {
  tenantId: string;
  buildings: Building[];
  onSuccess?: () => void;
}

export default function CreateLiquidationModal({
  tenantId,
  buildings,
  onSuccess,
}: CreateLiquidationModalProps) {
  const [open, setOpen] = useState(false);
  const [buildingId, setBuildingId] = useState('');
  const [period, setPeriod] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('ARS');
  const [error, setError] = useState('');

  const createMutation = useCreateLiquidation(tenantId);

  const handleCreate = async () => {
    if (!buildingId || !period) {
      setError('Todos los campos son requeridos');
      return;
    }

    try {
      await createMutation.mutateAsync({
        buildingId,
        period,
        baseCurrency,
      });
      setOpen(false);
      setBuildingId('');
      setPeriod('');
      setBaseCurrency('ARS');
      setError('');
      onSuccess?.();
    } catch (err: any) {
      setError(err.message || 'Error al crear la liquidación');
    }
  };

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        disabled={buildings.length === 0 || createMutation.isPending}
        className="flex items-center gap-1"
      >
        <Plus className="w-4 h-4" />
        Nueva Liquidación
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-0">
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="font-semibold">Crear Liquidación</h3>
          <button
            onClick={() => setOpen(false)}
            disabled={createMutation.isPending}
            className="text-gray-500 hover:text-gray-700 disabled:opacity-50"
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

          {error && <p className="text-sm text-red-600">{error}</p>}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              onClick={handleCreate}
              disabled={!buildingId || !period || createMutation.isPending}
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
  );
}
