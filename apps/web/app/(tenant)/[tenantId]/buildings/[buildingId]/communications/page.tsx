'use client';

import { useParams } from 'next/navigation';
import { BuildingBreadcrumb, BuildingSubnav } from '@/features/buildings/components';
import { CommunicationsList } from '@/features/buildings/components/communications';

type BuildingParams = {
  tenantId: string;
  buildingId: string;
};

/**
 * CommunicationsPage: Display all communications for a building with CRUD
 */
export default function CommunicationsPage() {
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
        buildingName="Comunicados"
        buildingId={buildingId}
      />

      <BuildingSubnav tenantId={tenantId} buildingId={buildingId} />

      <CommunicationsList buildingId={buildingId} tenantId={tenantId} />
    </div>
  );
}
