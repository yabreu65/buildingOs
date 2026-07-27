'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Building2, Home } from 'lucide-react';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { useContextManager } from '@/features/context/useContext';
import { ContextSelector } from '@/features/context/components/ContextSelector';
import Card from '@/shared/components/ui/Card';
import Skeleton from '@/shared/components/ui/Skeleton';

interface ResidentContextSwitcherProps {
  tenantId: string;
}

function countAccessibleUnits(unitsByBuilding: Record<string, { id: string }[]>): number {
  return Object.values(unitsByBuilding).reduce((count, units) => count + units.length, 0);
}

export function ResidentContextSwitcher({ tenantId }: ResidentContextSwitcherProps) {
  const queryClient = useQueryClient();
  const session = useAuthSession();
  const userId = session?.user.id ?? null;
  const { context, options, loading, error, refetch, setActiveUnit } = useContextManager(tenantId);

  const totalUnits = countAccessibleUnits(options?.unitsByBuilding ?? {});

  const selectedBuilding = (() => {
    if (!context?.activeBuildingId) return null;
    return options?.buildings.find((building) => building.id === context.activeBuildingId) ?? null;
  })();

  const selectedUnit = (() => {
    if (!context?.activeBuildingId || !context?.activeUnitId) return null;
    return options?.unitsByBuilding[context.activeBuildingId]?.find((unit) => unit.id === context.activeUnitId) ?? null;
  })();

  const invalidateResidentQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['residentContext', tenantId, userId] }),
      queryClient.invalidateQueries({ queryKey: ['residentLedger', tenantId, userId] }),
      queryClient.invalidateQueries({ queryKey: ['residentPayments', tenantId, userId] }),
      queryClient.invalidateQueries({ queryKey: ['residentDocuments', tenantId, userId] }),
      queryClient.invalidateQueries({ queryKey: ['residentTickets', tenantId, userId] }),
      queryClient.invalidateQueries({ queryKey: ['residentCommunications', tenantId, userId] }),
    ]);
  }, [queryClient, tenantId, userId]);

  const handleUnitChange = useCallback(
    async (buildingId: string | null, unitId: string | null) => {
      await setActiveUnit(buildingId, unitId);
      await invalidateResidentQueries();
    },
    [invalidateResidentQueries, setActiveUnit],
  );

  if (loading && !context && !options) {
    return (
      <Card className="w-full min-w-0 p-4">
        <div className="min-w-0 space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-10 w-full max-w-md" />
        </div>
      </Card>
    );
  }

  if (error && !options) {
    return (
      <Card className="w-full min-w-0 border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/30">
        <div className="flex min-w-0 items-start gap-3">
          <AlertCircle className="mt-0.5 shrink-0 text-red-600 dark:text-red-300" size={20} />
          <div className="min-w-0 space-y-1">
            <p className="font-medium text-red-800 dark:text-red-100">No pudimos cargar tu contexto residente.</p>
            <p className="text-sm text-red-700 dark:text-red-200">
              {error}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="text-sm font-medium text-red-700 hover:underline dark:text-red-200"
            >
              Reintentar
            </button>
          </div>
        </div>
      </Card>
    );
  }

  if (totalUnits <= 1) {
    return (
      <Card className="w-full min-w-0 p-4">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
          <div className="w-fit shrink-0 rounded-lg bg-primary/10 p-2 text-primary">
            <Home size={18} />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold text-foreground">Contexto activo</p>
            {context?.activeUnitId && selectedBuilding && selectedUnit ? (
              <p className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
                <span className="min-w-0 flex-1 truncate" title={selectedBuilding.name}>{selectedBuilding.name}</span>
                <span className="shrink-0" aria-hidden="true">·</span>
                <span
                  className="min-w-0 max-w-[min(16rem,calc(100vw-8rem))] truncate"
                  title={selectedUnit.label || selectedUnit.code}
                >
                  {selectedUnit.label || selectedUnit.code}
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Sin unidad activa autorizada.</p>
            )}
            <p className="text-xs text-muted-foreground">
              {totalUnits === 1
                ? 'Tu portal usa una única ocupación autorizada.'
                : 'Si se autoriza una nueva ocupación, la vas a poder elegir desde acá.'}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="w-full min-w-0 p-4">
      <div className="mb-3 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
        <div className="w-fit shrink-0 rounded-lg bg-primary/10 p-2 text-primary">
          <Building2 size={18} />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-foreground">Elegí tu unidad activa</p>
          <p className="text-xs text-muted-foreground">
            El portal residente usa siempre la ocupación seleccionada. Si cambiás de unidad, los datos se actualizan en toda la pantalla.
          </p>
        </div>
      </div>

      <ContextSelector
        tenantId={tenantId}
        context={context}
        options={options?.buildings ?? []}
        unitsByBuilding={options?.unitsByBuilding ?? {}}
        onBuildingChange={async () => {}}
        onUnitChange={handleUnitChange}
        autoSelectFirstUnitOnBuildingChange
        allowAllBuildings={false}
        allowAllUnits={false}
        isLoading={loading}
      />
    </Card>
  );
}
