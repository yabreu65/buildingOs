'use client';

import React, { useState } from 'react';
import { useContextManager } from '../useContext';
import { UserContext, ContextOption } from '../context.types';

interface ContextSelectorProps {
  tenantId: string;
  context: UserContext | null;
  options: ContextOption[];
  unitsByBuilding: Record<string, ContextOption[]>;
  onBuildingChange: (buildingId: string | null) => Promise<void>;
  onUnitChange: (buildingId: string | null, unitId: string | null) => Promise<void>;
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
  isLoading = false,
}: ContextSelectorProps) {
  const [error, setError] = useState<string | null>(null);
  const [isChanging, setIsChanging] = useState(false);

  const handleBuildingChange = async (buildingId: string) => {
    setError(null);
    setIsChanging(true);

    try {
      const effectiveBuildingId = buildingId === '' ? null : buildingId;
      await onBuildingChange(effectiveBuildingId);
      // Auto-clear unit when changing building
      if (context?.activeUnitId) {
        await onUnitChange(effectiveBuildingId, null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to change building';
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
      const message = err instanceof Error ? err.message : 'Failed to change unit';
      setError(message);
    } finally {
      setIsChanging(false);
    }
  };

  const currentBuilding =
    options.find((b) => b.id === context?.activeBuildingId)?.name ||
    (context?.activeBuildingId ? 'Unknown Building' : 'All Buildings');

  const currentUnit =
    context?.activeBuildingId &&
    unitsByBuilding[context.activeBuildingId]?.find((u) => u.id === context.activeUnitId)
      ?.label;

  const unitsForActiveBuilding = context?.activeBuildingId
    ? unitsByBuilding[context.activeBuildingId] || []
    : [];

  return (
    <div className="flex items-center gap-3">
      {error && (
        <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded">
          {error}
        </div>
      )}

      {/* Building Selector */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-600">Building</label>
        <select
          value={context?.activeBuildingId || ''}
          onChange={(e) => handleBuildingChange(e.target.value)}
          disabled={isLoading || isChanging}
          className="px-3 py-2 border rounded text-sm bg-white disabled:bg-gray-100"
        >
          <option value="">All Buildings</option>
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
          <label className="text-xs font-medium text-gray-600">Unit</label>
          <select
            value={context?.activeUnitId || ''}
            onChange={(e) => handleUnitChange(e.target.value)}
            disabled={isLoading || isChanging}
            className="px-3 py-2 border rounded text-sm bg-white disabled:bg-gray-100"
          >
            <option value="">All Units</option>
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
        <div className="text-xs text-gray-500">Updating context...</div>
      )}
    </div>
  );
}
