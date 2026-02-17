'use client';

import { useParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Table, THead, TR, TH, TBody, TD } from '../../shared/components/ui/Table';
import Badge from '../../shared/components/ui/Badge';
import Button from '../../shared/components/ui/Button';
import Input from '../../shared/components/ui/Input';
import { useCan } from '../rbac/rbac.hooks';
import { useBoStorageTick } from '../../shared/lib/storage/useBoStorage';
import type { Unit, Building, User } from './units.types';
import {
  listUnits,
  createUnit,
  deleteUnit,
} from './units.storage';
import { listBuildings, seedBuildingsIfEmpty } from './buildings.storage';
import { listUsers, seedUsersIfEmpty, listResidents } from './users.storage';
import {
  listUnitResidents,
  getActiveResident,
  assignResident,
  unassignResident,
} from './unitResidents.storage';

// Zod schema para crear/editar unidad
const createUnitSchema = z.object({
  buildingId: z.string().min(1, 'Edificio requerido'),
  label: z.string().min(1, 'Label requerido').min(2, 'Label mínimo 2 caracteres'),
  unitCode: z.string().optional(),
  unitType: z.enum(['APARTMENT', 'HOUSE', 'OFFICE', 'STORAGE', 'PARKING', 'OTHER']).optional(),
  occupancyStatus: z.enum(['UNKNOWN', 'VACANT', 'OCCUPIED']).optional(),
});

type CreateUnitFormData = z.infer<typeof createUnitSchema>;

export default function UnitsUI() {
  const params = useParams();
  const tenantId = params?.tenantId as string | undefined;

  const canWrite = useCan('units.write');

  // Re-render cuando cambie localStorage
  useBoStorageTick();

  // Estado del componente
  const [units, setUnits] = useState<Unit[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [residents, setResidents] = useState<User[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );
  const [residentModal, setResidentModal] = useState<{
    unitId: string;
    unitLabel: string;
  } | null>(null);
  const [selectedResident, setSelectedResident] = useState<string>('');
  const [deleteModal, setDeleteModal] = useState<{
    unitId: string;
    unitLabel: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Inicialización: seed datos y cargar estado
  useEffect(() => {
    if (!tenantId) return;

    seedBuildingsIfEmpty(tenantId);
    seedUsersIfEmpty(tenantId);

    const loadedUnits = listUnits(tenantId);
    const loadedBuildings = listBuildings(tenantId);
    const loadedResidents = listResidents(tenantId);

    setUnits(loadedUnits);
    setBuildings(loadedBuildings);
    setResidents(loadedResidents);
  }, [tenantId]);

  // React Hook Form setup
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    watch,
  } = useForm<CreateUnitFormData>({
    resolver: zodResolver(createUnitSchema),
    defaultValues: {
      buildingId: '',
      label: '',
      unitCode: '',
      unitType: undefined,
      occupancyStatus: undefined,
    },
  });

  const selectedBuildingId = watch('buildingId');

  // Handler para crear unidad
  const onCreateUnit = async (data: CreateUnitFormData) => {
    if (!tenantId) {
      setFeedback({ type: 'error', message: 'Tenant ID no disponible' });
      return;
    }

    try {
      // 1. Limpiar inputs antes de enviar al storage
      const cleanedLabel = data.label.trim();
      const cleanedUnitCode = data.unitCode?.trim() || undefined;

      // 2. Crear unidad con valores limpios
      const newUnit = createUnit(tenantId, {
        ...data,
        label: cleanedLabel,
        unitCode: cleanedUnitCode,
      });

      const updated = listUnits(tenantId);
      setUnits(updated);
      reset();
      setShowForm(false);
      setFeedback({ type: 'success', message: `Unidad "${newUnit.label}" creada` });
      setTimeout(() => setFeedback(null), 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al crear unidad';
      setFeedback({ type: 'error', message });
    }
  };

  // Handler para asignar residente
  const onAssignResident = async () => {
    if (!tenantId || !residentModal) return;

    try {
      if (selectedResident) {
        assignResident(tenantId, residentModal.unitId, selectedResident);
      } else {
        unassignResident(tenantId, residentModal.unitId);
      }

      const updated = listUnits(tenantId);
      setUnits(updated);
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
      deleteUnit(tenantId, deleteModal.unitId);
      const updated = listUnits(tenantId);
      setUnits(updated);
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

  // Helper para obtener nombre del residente actual
  const getActiveResidentName = (unitId: string): string | null => {
    if (!tenantId) return null;
    const activeRes = getActiveResident(tenantId, unitId);
    if (!activeRes) return null;
    const user = residents.find((u) => u.id === activeRes.residentUserId);
    return user?.fullName || null;
  };

  // Helper para obtener nombre del edificio
  const getBuildingName = (buildingId: string): string => {
    return buildings.find((b) => b.id === buildingId)?.name || '—';
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

      {/* Formulario de creación */}
      {showForm && canWrite && (
        <div className="border border-input rounded-lg p-4 bg-muted/30 space-y-3">
          <h4 className="font-medium text-sm">Crear nueva unidad</h4>

          <form onSubmit={handleSubmit(onCreateUnit)} className="space-y-3">
            {/* Edificio (requerido) */}
            <div>
              <label htmlFor="buildingId" className="block text-sm font-medium mb-1">
                Edificio *
              </label>
              <select
                id="buildingId"
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm"
                {...register('buildingId')}
              >
                <option value="">Seleccionar edificio</option>
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              {errors.buildingId && (
                <p className="text-xs text-red-600 mt-1">{errors.buildingId.message}</p>
              )}
            </div>

            {/* Label (requerido) */}
            <div>
              <label htmlFor="label" className="block text-sm font-medium mb-1">
                Label *
              </label>
              <Input
                id="label"
                placeholder="Ej: Apto 101"
                {...register('label')}
              />
              {errors.label && (
                <p className="text-xs text-red-600 mt-1">{errors.label.message}</p>
              )}
            </div>

            {/* Código / External ID (opcional) */}
            <div>
              <label htmlFor="unitCode" className="block text-sm font-medium mb-1">
                Código / External ID (opcional)
              </label>
              <Input
                id="unitCode"
                placeholder="Ej: UF-101"
                {...register('unitCode')}
              />
              {errors.unitCode && (
                <p className="text-xs text-red-600 mt-1">{errors.unitCode.message}</p>
              )}
            </div>

            {/* Tipo de unidad (opcional) */}
            <div>
              <label htmlFor="unitType" className="block text-sm font-medium mb-1">
                Tipo de unidad (opcional)
              </label>
              <select
                id="unitType"
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm"
                {...register('unitType')}
              >
                <option value="">Sin especificar</option>
                <option value="APARTMENT">Apartamento</option>
                <option value="HOUSE">Casa</option>
                <option value="OFFICE">Oficina</option>
                <option value="STORAGE">Almacén</option>
                <option value="PARKING">Estacionamiento</option>
                <option value="OTHER">Otro</option>
              </select>
              {errors.unitType && (
                <p className="text-xs text-red-600 mt-1">{errors.unitType.message}</p>
              )}
            </div>

            {/* Estado de ocupación (opcional) */}
            <div>
              <label htmlFor="occupancyStatus" className="block text-sm font-medium mb-1">
                Estado de ocupación (opcional)
              </label>
              <select
                id="occupancyStatus"
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm"
                {...register('occupancyStatus')}
              >
                <option value="">Sin especificar</option>
                <option value="UNKNOWN">Desconocido</option>
                <option value="VACANT">Vacío</option>
                <option value="OCCUPIED">Ocupado</option>
              </select>
              {errors.occupancyStatus && (
                <p className="text-xs text-red-600 mt-1">{errors.occupancyStatus.message}</p>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Guardando...' : 'Guardar Unidad'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowForm(false);
                  reset();
                }}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Tabla de unidades */}
      {units.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          Sin unidades registradas
        </div>
      ) : (
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
            {units.map((u) => {
              const activeResidentName = getActiveResidentName(u.id);
              return (
                <TR key={u.id}>
                  <TD>{getBuildingName(u.buildingId)}</TD>
                  <TD className="font-medium">{u.label}</TD>
                  <TD>{u.unitCode || '—'}</TD>
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
                        setResidentModal({ unitId: u.id, unitLabel: u.label });
                        const active = tenantId ? getActiveResident(tenantId, u.id) : null;
                        setSelectedResident(active?.residentUserId || '');
                      }}
                    >
                      Asignar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => setDeleteModal({ unitId: u.id, unitLabel: u.label })}
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
                >
                  <option value="">Sin asignar</option>
                  {residents.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.fullName}
                    </option>
                  ))}
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
