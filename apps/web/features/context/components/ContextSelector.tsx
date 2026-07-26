'use client';

import React, { useState } from 'react';
import { UserContext, ContextOption } from '../context.types';

interface ContextSelectorProps {
  tenantId: string;
  context: UserContext | null;
  options: ContextOption[];
  unitsByBuilding: Record<string, ContextOption[]>;
  onBuildingChange: (buildingId: string | null) => Promise<void>;
  onUnitChange: (buildingId: string | null, unitId: string | null) => Promise<void>;
  autoSelectFirstUnitOnBuildingChange?: boolean;
  allowAllBuildings?: boolean;
  allowAllUnits?: boolean;
  isLoading?: boolean;
}

/**
 * ContextSelector: Global dropdown for switching active building/unit
 *
 * Features:
 * - Building selector (shows "All Buildings" for tenant-level)
 * - Unit selector (cascades based on selected building)
 * - Shows current context clearly
 * - Prevents invalid selections
 */
export function ContextSelector({
  tenantId,
  context,
  options,
  unitsByBuilding,
  onBuildingChange,
  onUnitChange,
  autoSelectFirstUnitOnBuildingChange = false,
  allowAllBuildings = true,
  allowAllUnits = true,
  isLoading = false,
}: ContextSelectorProps) {
  const [error, setError] = useState<string | null>(null);
  const [isChanging, setIsChanging] = useState(false);
  const buildingSelectId = `context-building-select-${tenantId}`;
  const unitSelectId = `context-unit-select-${tenantId}`;

  const handleBuildingChange = async (buildingId: string) => {
    setError(null);
    setIsChanging(true);

    try {
      const effectiveBuildingId = buildingId === '' ? null : buildingId;
      await onBuildingChange(effectiveBuildingId);
      if (autoSelectFirstUnitOnBuildingChange) {
        const unitsForBuilding = effectiveBuildingId
          ? unitsByBuilding[effectiveBuildingId] || []
          : [];
        const firstUnit = unitsForBuilding[0] ?? null;
        await onUnitChange(effectiveBuildingId, firstUnit?.id ?? null);
      } else if (context?.activeUnitId) {
        await onUnitChange(effectiveBuildingId, null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo cambiar el edificio';
      setError(message);
    } finally {
      setIsChanging(false);
    }
  };

  const handleUnitChange = async (unitId: string) => {
    setError(null);
    setIsChanging(true);

    try {
      const effectiveUnitId = unitId === '' ? null : unitId;
      await onUnitChange(context?.activeBuildingId || null, effectiveUnitId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo cambiar la unidad';
      setError(message);
    } finally {
      setIsChanging(false);
    }
  };

  const currentBuilding =
    options.find((b) => b.id === context?.activeBuildingId)?.name ||
    (context?.activeBuildingId ? 'Edificio no encontrado' : 'Todos los edificios');

  const currentUnit =
    context?.activeBuildingId &&
    unitsByBuilding[context.activeBuildingId]?.find((u) => u.id === context.activeUnitId)
      ?.label;

  const unitsForActiveBuilding = context?.activeBuildingId
    ? unitsByBuilding[context.activeBuildingId] || []
    : [];

  return (
    <div className="flex flex-wrap items-end gap-3">
      {error && (
        <div className="text-xs text-red-700 bg-red-50 px-2 py-1 rounded dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="w-full text-xs text-muted-foreground">
        Contexto actual:{' '}
        <span className="font-medium text-foreground">
          {currentBuilding}
          {currentUnit ? ` · ${currentUnit}` : ''}
        </span>
      </div>

      {/* Building Selector */}
      <div className="flex flex-col gap-1">
        <label htmlFor={buildingSelectId} className="text-xs font-medium text-muted-foreground">
          Edificio
        </label>
        <select
          id={buildingSelectId}
          value={context?.activeBuildingId || ''}
          onChange={(e) => handleBuildingChange(e.target.value)}
          disabled={isLoading || isChanging}
          className="px-3 py-2 border border-border rounded text-sm bg-background text-foreground disabled:bg-muted"
        >
          {allowAllBuildings && <option value="">Todos los edificios</option>}
          {options.map((building) => (
            <option key={building.id} value={building.id}>
              {building.name}
            </option>
          ))}
        </select>
      </div>

      {/* Unit Selector (only show if building selected) */}
      {context?.activeBuildingId && (
        <div className="flex flex-col gap-1">
          <label htmlFor={unitSelectId} className="text-xs font-medium text-muted-foreground">
            Unidad
          </label>
          <select
            id={unitSelectId}
            value={context?.activeUnitId || ''}
            onChange={(e) => handleUnitChange(e.target.value)}
            disabled={isLoading || isChanging}
            className="px-3 py-2 border border-border rounded text-sm bg-background text-foreground disabled:bg-muted"
          >
            {allowAllUnits && <option value="">Todas las unidades</option>}
            {unitsForActiveBuilding.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.label || unit.code}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Status indicator */}
      {isChanging && (
        <div className="text-xs text-muted-foreground">Actualizando contexto...</div>
      )}
    </div>
  );
}
