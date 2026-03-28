'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { BuildingBreadcrumb, BuildingSubnav } from '@/features/buildings/components';
import { CommunicationsList } from '@/features/communications';
import { fetchBuildingById } from '@/features/buildings/services/buildings.api';

interface BuildingParams {
  tenantId: string;
  buildingId: string;
  [key: string]: string | string[];
}

/**
 * CommunicationsPage: Admin communications management for a building
 */
// Next.js requires default export for page files; named export satisfies "prefer named exports" rule
export const CommunicationsPage = () => {
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
    return <div>Parámetros inválidos</div>;
  }

  return (
    <div className="space-y-6">
      <BuildingBreadcrumb
        tenantId={tenantId}
        buildingName={buildingName}
        buildingId={buildingId}
        sectionName="Comunicados"
      />

      <BuildingSubnav tenantId={tenantId} buildingId={buildingId} />

      <CommunicationsList buildingId={buildingId} tenantId={tenantId} />
    </div>
  );
};

export default CommunicationsPage;
