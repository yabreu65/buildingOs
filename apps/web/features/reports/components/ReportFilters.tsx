'use client';

import { useState } from 'react';
import { Button } from '@/shared/components/ui';
import type { Building } from '@/features/units/units.types';

interface ReportFiltersProps {
  buildings?: Building[];
  selectedBuildingId?: string;
  onBuildingChange?: (buildingId?: string) => void;
  onApply?: (filters: {
    buildingId?: string;
    from?: string;
    to?: string;
    period?: string;
  }) => void;
  hideBuildingSelector?: boolean;
  loading?: boolean;
}

export function ReportFilters({
  buildings = [],
  selectedBuildingId,
  onBuildingChange,
  onApply,
  hideBuildingSelector = false,
  loading = false,
}: ReportFiltersProps) {
  const [buildingId, setBuildingId] = useState(selectedBuildingId);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [period, setPeriod] = useState('');

  const handleApply = () => {
    onApply?.({
      buildingId,
      from: from || undefined,
      to: to || undefined,
      period: period || undefined,
    });
  };

  const handleBuildingChange = (newBuildingId?: string) => {
    setBuildingId(newBuildingId);
    onBuildingChange?.(newBuildingId);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="space-y-4">
        {/* Building Selector */}
        {!hideBuildingSelector && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Edificio
            </label>
            <select
              value={buildingId || ''}
              onChange={(e) =>
                handleBuildingChange(e.target.value || undefined)
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Todos los edificios</option>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Date Range */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Desde
            </label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Hasta
            </label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        {/* Period (Month) - Optional */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Período (Finanzas)
          </label>
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Apply Button */}
        <Button
          onClick={handleApply}
          disabled={loading}
          className="w-full"
        >
          {loading ? 'Cargando...' : 'Aplicar filtros'}
        </Button>
      </div>
    </div>
  );
}
