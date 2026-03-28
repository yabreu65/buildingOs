'use client';

import { useParams } from 'next/navigation';
import React, { useState } from 'react';
import { Table, THead, TR, TH, TBody, TD } from '../../shared/components/ui/Table';
import Badge from '../../shared/components/ui/Badge';
import Button from '../../shared/components/ui/Button';
import { useCan } from '../rbac/rbac.hooks';
import type { Unit } from './units.api';
import { useUnits } from './useUnits';
import { UnitCreateForm } from './components';
import { useBuildings } from '../buildings/hooks';
import { assignOccupant, removeOccupant, type CreateUnitInput } from './units.api';
import { tenantMembersApi, type AssignableResident } from '../tenant-members/api/tenant-members.api';

// Building interface from storage
interface Building {
  id: string;
  tenantId: string;
  name: string;
  address: string;
  createdAt: string;
}

export const UnitsUI = () => {
  const params = useParams();
  const tenantId = params?.tenantId as string | undefined;

  const canWrite = useCan('units.write');

  // State for building tabs
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);

  // Fetch all units for accurate counts in button labels and display
  const {
    units: allUnits,
    loading,
    error,
    refetch: refetchUnits,
    createUnit: apiCreateUnit,
    deleteUnit: apiDeleteUnit,
  } = useUnits({
    tenantId,
    buildingId: undefined, // Always fetch all units
  });

// Filter units for display based on selected building
  const units = selectedBuildingId === null 
    ? [] // Show no units when no building selected
    : selectedBuildingId === 'all' 
      ? allUnits 
      : allUnits.filter(unit => unit.buildingId === selectedBuildingId);

  // Fetch buildings from API (real buildings, not mock storage)
  const { buildings, loading: buildingsLoading } = useBuildings(tenantId);

// Group all units by building (for button counts)
  const unitsByBuilding = React.useMemo(() => {
    const grouped: Record<string, typeof allUnits> = {};
    for (const unit of allUnits) {
      const bId = unit.buildingId || 'unknown';
      if (!grouped[bId]) grouped[bId] = [];
      grouped[bId].push(unit);
    }
    return grouped;
  }, [allUnits]);

// Get filtered units based on selected building
  const filteredUnits = selectedBuildingId === null 
    ? [] // Show no units when no building selected
    : selectedBuildingId === 'all' 
      ? units 
      : unitsByBuilding[selectedBuildingId] || [];

  const [assignableResidents, setAssignableResidents] = useState<AssignableResident[]>([]);
  const [isLoadingResidents, setIsLoadingResidents] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );
  const [residentModal, setResidentModal] = useState<{
    unitId: string;
    buildingId: string;
    unitLabel: string;
    currentOccupants: { id: string; memberId: string }[];
  } | null>(null);
  const [selectedResident, setSelectedResident] = useState<string>('');
  const [deleteModal, setDeleteModal] = useState<{
    unitId: string;
    buildingId: string;
    unitLabel: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Load assignable residents when modal opens
  React.useEffect(() => {
    if (!residentModal || !tenantId) return;
    setIsLoadingResidents(true);
    tenantMembersApi
      .getAssignableResidents(tenantId, residentModal.unitId)
      .then(setAssignableResidents)
      .catch(() => setAssignableResidents([]))
      .finally(() => setIsLoadingResidents(false));
  }, [residentModal?.unitId, tenantId]);

  // Handler para crear unidad (delegado al componente unificado)
  const handleCreateUnitSuccess = (unit: Unit) => {
    setShowForm(false);
    setFeedback({ type: 'success', message: `Unidad "${unit.label}" creada` });
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleCreateUnit = async (buildingId: string, input: Omit<CreateUnitInput, 'buildingId'>) => {
    return await apiCreateUnit(buildingId, input);
  };

  // Handler para asignar residente
  const onAssignResident = async () => {
    if (!tenantId || !residentModal) return;

    try {
      const { unitId, buildingId, currentOccupants } = residentModal;

      // Remove all current occupants first
      for (const occ of currentOccupants) {
        await removeOccupant(tenantId, buildingId, unitId, occ.id);
      }

      // Assign new one if selected
      if (selectedResident) {
        await assignOccupant(tenantId, buildingId, unitId, selectedResident, 'RESIDENT');
      }

      await refetchUnits();
      setResidentModal(null);
      setSelectedResident('');
      setFeedback({ type: 'success', message: 'Residente actualizado' });
      setTimeout(() => setFeedback(null), 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al asignar residente';
      setFeedback({ type: 'error', message });
    }
  };

  // Handler para eliminar unidad
  const onDeleteUnit = async () => {
    if (!tenantId || !deleteModal) return;

    setIsDeleting(true);
    try {
      await apiDeleteUnit(deleteModal.buildingId, deleteModal.unitId);
      setDeleteModal(null);
      setFeedback({ type: 'success', message: `Unidad "${deleteModal.unitLabel}" eliminada` });
      setTimeout(() => setFeedback(null), 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al eliminar unidad';
      setFeedback({ type: 'error', message });
    } finally {
      setIsDeleting(false);
    }
  };

  // Helper para obtener nombre del ocupante actual (desde datos del backend)
  const getActiveResidentName = (unit: typeof units[0]): string | null => {
    const occ = unit.unitOccupants?.[0];
    return occ?.member?.name ?? null;
  };

  // Helper para obtener nombre del edificio (desde API data)
  const getBuildingName = (unit: Unit): string => {
    return unit.building?.name || '—';
  };

  // Get building name by ID
  const getBuildingNameById = (buildingId: string): string => {
    const building = buildings.find(b => b.id === buildingId);
    return building?.name || buildingId;
  };

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'VACANT':
        return <Badge className="bg-blue-100 text-blue-800">Vacío</Badge>;
      case 'OCCUPIED':
        return <Badge className="bg-green-100 text-green-800">Ocupado</Badge>;
      default:
        return <span className="text-sm text-muted-foreground">—</span>;
    }
  };

  if (!tenantId) {
    return <div className="text-sm text-muted-foreground">Tenant no disponible</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header + Botón */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Unidades</h3>
        {canWrite && !showForm && (
          <Button onClick={() => setShowForm(true)}>+ Nueva Unidad</Button>
        )}
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          className={`px-4 py-3 rounded-md text-sm ${
            feedback.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Formulario de creación - Componente Unificado */}
      {showForm && canWrite && (
        <UnitCreateForm
          tenantId={tenantId || ''}
          buildings={buildings}
          onSuccess={handleCreateUnitSuccess}
          onCancel={() => setShowForm(false)}
          onCreateUnit={handleCreateUnit}
        />
      )}

       {/* Building Tabs */}
        {!loading && buildings.length > 0 && (
          <div className="mb-4">
            <div className="flex flex-wrap gap-2">
              {buildings
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((building) => (
                  <button
                    key={building.id}
                    onClick={() => setSelectedBuildingId(building.id)}
                    className={`flex-1 items-center justify-center px-3 py-2 rounded-md text-sm font-medium transition-all ${
                      selectedBuildingId === building.id
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'bg-muted text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    }`}
                  >
                    {building.name} ({(unitsByBuilding[building.id] || []).length})
                  </button>
                ))}
              <button
                onClick={() => setSelectedBuildingId('all')}
                className={`flex-1 items-center justify-center px-3 py-2 rounded-md text-sm font-medium transition-all ${
                  selectedBuildingId === 'all'
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'bg-muted text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                Todos ({allUnits.length})
              </button>
            </div>
          </div>
        )}

      {/* Estado: Loading */}
      {loading && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          Cargando unidades...
        </div>
      )}

      {/* Estado: Error */}
      {error && !loading && (
        <div className="px-4 py-3 rounded-md text-sm bg-red-50 border border-red-200 text-red-800">
          Error al cargar unidades: {error.message}
        </div>
      )}

       {/* Tabla de unidades */}
       {!loading && filteredUnits.length === 0 && (
         <div className="text-center py-8 text-muted-foreground text-sm">
           {selectedBuildingId === null
             ? 'Seleccioná un edificio para ver las unidades'
             : selectedBuildingId === 'all'
               ? 'Sin unidades registradas'
               : `Sin unidades en ${getBuildingNameById(selectedBuildingId)}`}
         </div>
       )}

       {!loading && filteredUnits.length > 0 && (
         <Table>
           <THead>
             <TR>
               <TH>Edificio</TH>
               <TH>Label</TH>
               <TH>Código</TH>
               <TH>Estado</TH>
               <TH>Residente</TH>
               <TH>Acciones</TH>
             </TR>
           </THead>
           <TBody>
             {filteredUnits.map((u: typeof units[0]) => {
               const activeResidentName = getActiveResidentName(u);
               return (
                 <TR key={u.id}>
                   <TD>{getBuildingName(u)}</TD>
                   <TD className="font-medium">{u.label}</TD>
                   <TD>{u.code || '—'}</TD>
                   <TD>
                     {u.occupancyStatus === 'VACANT' && (
                       <Badge className="bg-blue-100 text-blue-800">Vacío</Badge>
                     )}
                     {u.occupancyStatus === 'OCCUPIED' && (
                       <Badge className="bg-green-100 text-green-800">Ocupado</Badge>
                     )}
                     {!u.occupancyStatus && <span className="text-sm text-muted-foreground">—</span>}
                   </TD>
                   <TD>{activeResidentName ? <Badge>{activeResidentName}</Badge> : '—'}</TD>
                   <TD className="flex gap-1">
                     <Button
                       variant="ghost"
                       size="sm"
                       onClick={() => {
                         const currentOccupants = (u.unitOccupants ?? []).map((o) => ({
                           id: o.id,
                           memberId: o.memberId,
                         }));
                         setResidentModal({
                           unitId: u.id,
                           buildingId: u.buildingId,
                           unitLabel: u.label,
                           currentOccupants,
                         });
                         setSelectedResident(currentOccupants[0]?.memberId ?? '');
                       }}
                     >
                       Asignar
                     </Button>
                     <Button
                       variant="ghost"
                       size="sm"
                       className="text-red-600 hover:text-red-700 hover:bg-red-50"
                       onClick={() =>
                         setDeleteModal({ unitId: u.id, buildingId: u.buildingId, unitLabel: u.label })
                       }
                     >
                       Eliminar
                     </Button>
                   </TD>
                 </TR>
               );
             })}
           </TBody>
         </Table>
       )}

      {/* Modal para asignar residente */}
      {residentModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">
              Asignar residente a "{residentModal.unitLabel}"
            </h3>

            <div className="space-y-4">
              <div>
                <label htmlFor="resident-select" className="block text-sm font-medium mb-2">
                  Residente (opcional)
                </label>
                <select
                  id="resident-select"
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm"
                  value={selectedResident}
                  onChange={(e) => setSelectedResident(e.target.value)}
                  disabled={isLoadingResidents}
                >
                  <option value="">Sin asignar</option>
                  {isLoadingResidents ? (
                    <option disabled>Cargando...</option>
                  ) : (
                    assignableResidents.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}{r.email ? ` (${r.email})` : ''}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setResidentModal(null);
                    setSelectedResident('');
                  }}
                >
                  Cancelar
                </Button>
                <Button type="button" onClick={onAssignResident}>
                  Guardar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación para eliminar */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-2 text-red-600">
              ¿Eliminar unidad?
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Estás a punto de eliminar la unidad "<strong>{deleteModal.unitLabel}</strong>". Esta acción no se puede deshacer.
            </p>

            <div className="flex gap-2 justify-end pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDeleteModal(null)}
                disabled={isDeleting}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={onDeleteUnit}
                disabled={isDeleting}
              >
                {isDeleting ? 'Eliminando...' : 'Eliminar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
