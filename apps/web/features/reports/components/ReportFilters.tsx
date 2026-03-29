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
    <div className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm md:p-5">
      <div className="space-y-4">
        {/* Building Selector */}
        {!hideBuildingSelector && (
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Edificio
            </label>
            <select
              value={buildingId || ''}
              onChange={(e) =>
                handleBuildingChange(e.target.value || undefined)
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Desde
            </label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">
              Hasta
            </label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        {/* Period (Month) - Optional */}
        <div>
          <label className="mb-2 block text-sm font-medium text-foreground">
            Período (Finanzas)
          </label>
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
