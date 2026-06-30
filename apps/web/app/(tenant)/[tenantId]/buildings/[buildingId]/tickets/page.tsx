'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BuildingBreadcrumb, BuildingSubnav } from '@/features/buildings/components';
import { TicketsList } from '@/features/tickets';
import { fetchBuildingById } from '@/features/buildings/services/buildings.api';

interface BuildingParams {
  tenantId: string;
  buildingId: string;
  [key: string]: string | string[];
}

export default function TicketsPage() {
  const params = useParams<BuildingParams>();
  const tenantId = params?.tenantId;
  const buildingId = params?.buildingId;
  const [buildingName, setBuildingName] = useState<string>('');

  useEffect(() => {
    if (!tenantId || !buildingId) return;
    fetchBuildingById(tenantId, buildingId)
      .then((b) => setBuildingName(b.name))
      .catch(() => setBuildingName(''));
  }, [tenantId, buildingId]);

  if (!tenantId || !buildingId) {
    return <div>Invalid parameters</div>;
  }

  return (
    <div className="space-y-6">
      <BuildingBreadcrumb
        tenantId={tenantId}
        buildingName={buildingName}
        buildingId={buildingId}
        sectionName="Solicitudes"
      />

      <BuildingSubnav tenantId={tenantId} buildingId={buildingId} />

      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Tickets del edificio</h1>
        <p className="text-sm text-muted-foreground">
          Solicitudes y problemas reportados en este edificio.
        </p>
      </div>

      <TicketsList buildingId={buildingId} tenantId={tenantId} />
    </div>
  );
}
