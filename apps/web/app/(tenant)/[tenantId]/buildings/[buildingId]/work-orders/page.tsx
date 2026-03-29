'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BuildingBreadcrumb } from '@/features/buildings/components/BuildingBreadcrumb';
import { BuildingSubnav } from '@/features/buildings/components/BuildingSubnav';
import { WorkOrdersList } from '@/features/vendors';
import { fetchBuildingById } from '@/features/buildings/services/buildings.api';

interface BuildingParams {
  tenantId: string;
  buildingId: string;
  [key: string]: string | string[];
}

/**
 * Work orders page component
 */
export default function WorkOrdersPage() {
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
      <BuildingBreadcrumb tenantId={tenantId} buildingName={buildingName} buildingId={buildingId} sectionName="Órdenes de Trabajo" />
      <BuildingSubnav tenantId={tenantId} buildingId={buildingId} />
      <WorkOrdersList buildingId={buildingId} />
    </div>
  );
}
