'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Home,
  User,
  Users,
  AlertCircle,
  CheckCircle,
  Loader2,
  Building2,
} from 'lucide-react';
import { useResidentContext } from '../../../../../features/resident/hooks/useResidentContext';
import { getContextOptions } from '../../../../../features/context/context.api';
import { getUnit, type Unit } from '../../../../../features/units/units.api';
import { useTenants } from '../../../../../features/tenants/tenants.hooks';
import Card from '../../../../../shared/components/ui/Card';
import Skeleton from '../../../../../shared/components/ui/Skeleton';

function unitTypeLabel(type: Unit['unitType']): string {
  const labels: Record<Unit['unitType'], string> = {
    APARTMENT: 'Departamento',
    HOUSE: 'Casa',
    OFFICE: 'Oficina',
    STORAGE: 'Depósito',
    PARKING: 'Estacionamiento',
    OTHER: 'Otro',
  };
  return labels[type] ?? type;
}

function occupancyStatusLabel(status: Unit['occupancyStatus']): string {
  const labels: Record<Unit['occupancyStatus'], string> = {
    OCCUPIED: 'Ocupada',
    VACANT: 'Vacante',
    UNKNOWN: 'Sin información',
  };
  return labels[status] ?? status;
}

function occupancyStatusColor(status: Unit['occupancyStatus']): string {
  const colors: Record<Unit['occupancyStatus'], string> = {
    OCCUPIED: 'bg-green-100 text-green-700 border-green-200',
    VACANT: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    UNKNOWN: 'bg-gray-100 text-gray-700 border-gray-200',
  };
  return colors[status] ?? 'bg-gray-100 text-gray-700 border-gray-200';
}

function roleLabel(role: 'OWNER' | 'RESIDENT'): string {
  return role === 'OWNER' ? 'Propietario' : 'Residente';
}

export default function ResidentUnitPage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId;

  const { data: tenants } = useTenants();
  const tenantName = tenants?.find((t) => t.id === tenantId)?.name ?? tenantId;

  const { data: context, isLoading: contextLoading } = useResidentContext(tenantId ?? null);
  const buildingId = context?.activeBuildingId;
  const unitId = context?.activeUnitId;

  const { data: contextOptions } = useQuery({
    queryKey: ['contextOptions', tenantId],
    queryFn: () => getContextOptions(tenantId!),
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
  });

  const buildingName = contextOptions?.buildings.find((b) => b.id === buildingId)?.name ?? null;
  const unitLabel = buildingId && unitId
    ? contextOptions?.unitsByBuilding[buildingId]?.find((u) => u.id === unitId)?.label ?? null
    : null;

  const { data: unit, isLoading: unitLoading } = useQuery<Unit>({
    queryKey: ['unit', buildingId, unitId],
    queryFn: () => getUnit(tenantId!, buildingId!, unitId!),
    enabled: !!buildingId && !!unitId && !!tenantId,
    staleTime: 5 * 60 * 1000,
  });

  if (contextLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  if (!buildingId || !unitId) {
    return (
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Home className="w-6 h-6" />
          Mi Unidad
        </h1>
        <p className="text-muted-foreground mt-1">{tenantName}</p>

        <Card className="p-4 mt-6 border-yellow-300 bg-yellow-50">
          <div className="flex items-center gap-2">
            <AlertCircle className="text-yellow-600" size={20} />
            <div>
              <p className="font-medium text-yellow-800">Sin unidad asignada</p>
              <p className="text-sm text-yellow-700">Comunicate con la administración para que te asignen una unidad.</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (unitLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid gap-4">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Home className="w-6 h-6" />
          Mi Unidad
        </h1>
        <p className="text-muted-foreground mt-1">
          {tenantName}
          {buildingName && ` • ${buildingName}`}
          {unitLabel && ` • Unidad ${unitLabel}`}
        </p>
      </div>

      {/* Unit Info Card */}
      <Card className="p-6">
        <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
          <Building2 className="w-5 h-5" />
          Información de la unidad
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          <div>
            <p className="text-sm text-muted-foreground">Código</p>
            <p className="font-medium text-lg">{unit?.code || unit?.label || '—'}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Tipo</p>
            <p className="font-medium">{unit?.unitType ? unitTypeLabel(unit.unitType) : '—'}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Superficie</p>
            <p className="font-medium">{unit?.m2 ? `${unit.m2} m²` : '—'}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Estado de ocupación</p>
            <span className={`inline-block px-2 py-1 rounded text-sm font-medium border ${unit?.occupancyStatus ? occupancyStatusColor(unit.occupancyStatus) : ''}`}>
              {unit?.occupancyStatus ? occupancyStatusLabel(unit.occupancyStatus) : '—'}
            </span>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Categoría</p>
            <p className="font-medium">{unit?.unitCategory?.name || 'Sin categoría'}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Edificio</p>
            <p className="font-medium">{buildingName || '—'}</p>
          </div>
        </div>
      </Card>

      {/* Occupants Card */}
      <Card className="p-6">
        <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
          <Users className="w-5 h-5" />
          Ocupantes
        </h2>
        {!unit?.unitOccupants || unit.unitOccupants.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8">
            <User className="w-10 h-10 text-muted-foreground mb-2" />
            <p className="text-muted-foreground">No hay ocupantes registrados</p>
          </div>
        ) : (
          <div className="space-y-3">
            {unit.unitOccupants.map((occupant) => (
              <div
                key={occupant.id}
                className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                    <User className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-medium">{occupant.member?.name || 'Sin nombre'}</p>
                    <p className="text-sm text-muted-foreground">{occupant.member?.email || 'Sin email'}</p>
                    {occupant.member?.phone && (
                      <p className="text-xs text-muted-foreground">{occupant.member.phone}</p>
                    )}
                  </div>
                </div>
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  occupant.role === 'OWNER'
                    ? 'bg-purple-100 text-purple-700'
                    : 'bg-blue-100 text-blue-700'
                }`}>
                  {roleLabel(occupant.role)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
