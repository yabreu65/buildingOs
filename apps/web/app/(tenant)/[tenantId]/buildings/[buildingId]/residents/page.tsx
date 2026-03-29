'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState, useMemo } from 'react';
import { BuildingBreadcrumb, BuildingSubnav } from '@/features/buildings/components';
import { useBuildings } from '@/features/buildings/hooks';
import { useUnits } from '@/features/buildings/hooks/useUnits';
import Card from '@/shared/components/ui/Card';
import Button from '@/shared/components/ui/Button';
import Badge from '@/shared/components/ui/Badge';
import { routes } from '@/shared/lib/routes';
import { Users, LayoutGrid, UserCog, Home, Mail, Phone } from 'lucide-react';

interface Occupant {
  id: string;
  unitId: string;
  memberId: string;
  role: 'OWNER' | 'RESIDENT';
  member?: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
  };
  unit?: {
    id: string;
    label: string;
    unitCode?: string;
  };
}

const BuildingResidentsPage = () => {
  const params = useParams();
  const router = useRouter();
  const tenantId = params.tenantId as string;
  const buildingId = params.buildingId as string;

  const { buildings, loading: buildingsLoading } = useBuildings(tenantId);
  const { units, loading: unitsLoading, error: unitsError } = useUnits(tenantId, buildingId);

  const [filter, setFilter] = useState<'all' | 'OWNER' | 'RESIDENT'>('all');

  const building = buildings.find((b) => b.id === buildingId);

  const occupants = useMemo<Occupant[]>(() => {
    const result: Occupant[] = [];
    for (const unit of units as any) {
      if (unit.unitOccupants && unit.unitOccupants.length > 0) {
        for (const occ of unit.unitOccupants) {
          result.push({
            id: occ.id,
            unitId: occ.unitId,
            memberId: occ.memberId,
            role: occ.role,
            member: occ.member ? {
              id: occ.member.id,
              name: occ.member.name || 'Sin nombre',
              email: occ.member.email,
              phone: occ.member.phone,
            } : undefined,
            unit: {
              id: unit.id,
              label: unit.label || unit.unitCode || 'Sin unidad',
              unitCode: unit.unitCode,
            },
          });
        }
      }
    }
    return result;
  }, [units]);

  const filteredOccupants = useMemo(() => {
    if (filter === 'all') return occupants;
    return occupants.filter((o) => o.role === filter);
  }, [occupants, filter]);

  if (buildingsLoading) {
    return <div className="p-6">Cargando...</div>;
  }

  if (!building) {
    return <div className="p-6">Edificio no encontrado</div>;
  }

  return (
    <div className="space-y-6">
      <BuildingBreadcrumb
        tenantId={tenantId}
        buildingName={building.name}
        buildingId={buildingId}
        sectionName="Residentes"
      />

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Residentes</h1>
          <p className="text-muted-foreground mt-1">
            Gestión de residentes en {building.name}
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => router.push(routes.buildingUnits(tenantId, buildingId))}
        >
          <LayoutGrid className="w-4 h-4 mr-2" />
          Ver Unidades
        </Button>
      </div>

      <BuildingSubnav tenantId={tenantId} buildingId={buildingId} />

      {unitsLoading ? (
        <Card>
          <div className="text-center py-8 text-muted-foreground">Cargando residentes...</div>
        </Card>
      ) : unitsError ? (
        <Card>
          <div className="text-center py-8 text-red-500">Error: {unitsError}</div>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                filter === 'all'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              <Users className="w-4 h-4" />
              Todos ({occupants.length})
            </button>
            <button
              onClick={() => setFilter('OWNER')}
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                filter === 'OWNER'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              <Home className="w-4 h-4" />
              Propietarios ({occupants.filter((o) => o.role === 'OWNER').length})
            </button>
            <button
              onClick={() => setFilter('RESIDENT')}
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                filter === 'RESIDENT'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              <UserCog className="w-4 h-4" />
              Residentes ({occupants.filter((o) => o.role === 'RESIDENT').length})
            </button>
          </div>

          {filteredOccupants.length === 0 ? (
            <Card>
              <div className="text-center py-12">
                <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  {filter === 'all'
                    ? 'No hay residentes asignados en este edificio'
                    : filter === 'OWNER'
                      ? 'No hay propietarios asignados'
                      : 'No hay residentes asignados'}
                </p>
                <Button
                  variant="secondary"
                  className="mt-4"
                  onClick={() => router.push(routes.buildingUnits(tenantId, buildingId))}
                >
                  Asignar desde Unidades
                </Button>
              </div>
            </Card>
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 font-medium">Nombre</th>
                      <th className="text-left py-3 px-4 font-medium">Unidad</th>
                      <th className="text-left py-3 px-4 font-medium">Rol</th>
                      <th className="text-left py-3 px-4 font-medium">Email</th>
                      <th className="text-left py-3 px-4 font-medium">Teléfono</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOccupants.map((occupant) => (
                      <tr key={occupant.id} className="border-b hover:bg-muted/50 transition">
                        <td className="py-3 px-4 font-medium">
                          {occupant.member?.name || 'Sin nombre'}
                        </td>
                        <td className="py-3 px-4">
                          <button
                            onClick={() => router.push(routes.unitDashboard(tenantId, buildingId, occupant.unitId))}
                            className="text-blue-600 hover:underline"
                          >
                            {occupant.unit?.label || '—'}
                          </button>
                        </td>
                        <td className="py-3 px-4">
                          <Badge
                            className={
                              occupant.role === 'OWNER'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-green-100 text-green-800'
                            }
                          >
                            {occupant.role === 'OWNER' ? 'Propietario' : 'Residente'}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          {occupant.member?.email ? (
                            <a
                              href={`mailto:${occupant.member.email}`}
                              className="flex items-center gap-1 text-blue-600 hover:underline"
                            >
                              <Mail className="w-3 h-3" />
                              {occupant.member.email}
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {occupant.member?.phone ? (
                            <span className="flex items-center gap-1">
                              <Phone className="w-3 h-3" />
                              {occupant.member.phone}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default BuildingResidentsPage;
