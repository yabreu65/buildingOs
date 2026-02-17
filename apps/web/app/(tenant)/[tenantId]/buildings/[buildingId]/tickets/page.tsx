'use client';

import { useParams } from 'next/navigation';
import { BuildingBreadcrumb, BuildingSubnav } from '@/features/buildings/components';
import { TicketsList } from '@/features/buildings/components/tickets';

type BuildingParams = {
  tenantId: string;
  buildingId: string;
};

/**
 * TicketsPage: Display all tickets for a building with full CRUD
 */
export default function TicketsPage() {
  const params = useParams<BuildingParams>();
  const tenantId = params?.tenantId;
  const buildingId = params?.buildingId;

  if (!tenantId || !buildingId) {
    return <div>Invalid parameters</div>;
  }

  return (
    <div className="space-y-6">
      <BuildingBreadcrumb
        tenantId={tenantId}
        buildingName="Tickets"
        buildingId={buildingId}
      />

      <BuildingSubnav tenantId={tenantId} buildingId={buildingId} />

      <TicketsList buildingId={buildingId} />
    </div>
  );
}
