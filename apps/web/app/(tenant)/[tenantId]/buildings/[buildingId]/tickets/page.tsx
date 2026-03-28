'use client';

import { useParams } from 'next/navigation';
import { BuildingBreadcrumb, BuildingSubnav } from '@/features/buildings/components';
import { useBuildings } from '@/features/buildings/hooks';
import { TicketsList } from '@/features/tickets';

interface BuildingParams {
  tenantId: string;
  buildingId: string;
  [key: string]: string | string[];
}

export default function TicketsPage() {
  const params = useParams<BuildingParams>();
  const tenantId = params?.tenantId;
  const buildingId = params?.buildingId;

  const { buildings } = useBuildings(tenantId);
  const building = buildings.find((b) => b.id === buildingId);

  if (!tenantId || !buildingId) {
    return <div>Invalid parameters</div>;
  }

  return (
    <div className="space-y-6">
      <BuildingBreadcrumb
        tenantId={tenantId}
        buildingName={building?.name || 'Tickets'}
        buildingId={buildingId}
      />

      <BuildingSubnav tenantId={tenantId} buildingId={buildingId} />

      <TicketsList buildingId={buildingId} tenantId={tenantId} />
    </div>
  );
}
