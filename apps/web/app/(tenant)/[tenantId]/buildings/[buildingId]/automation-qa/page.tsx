'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { BuildingBreadcrumb, BuildingSubnav } from '@/features/buildings/components';
import { fetchBuildingById } from '@/features/buildings/services/buildings.api';
import { AutomationQADashboard } from '@/features/automation-qa/components/AutomationQADashboard';

interface BuildingParams {
  tenantId: string;
  buildingId: string;
  [key: string]: string | string[];
}

export default function AutomationQAPage() {
  const params = useParams<BuildingParams>();
  const tenantId = params?.tenantId;
  const buildingId = params?.buildingId;
  const [buildingName, setBuildingName] = useState('');

  useEffect(() => {
    if (!tenantId || !buildingId) {
      return;
    }

    fetchBuildingById(tenantId, buildingId)
      .then((building) => setBuildingName(building.name))
      .catch(() => setBuildingName(''));
  }, [tenantId, buildingId]);

  if (!tenantId || !buildingId) {
    return <div>Invalid parameters</div>;
  }

  return (
    <div className="space-y-6">
      <BuildingBreadcrumb
        tenantId={tenantId}
        buildingId={buildingId}
        buildingName={buildingName}
        sectionName="Automation QA"
      />

      <BuildingSubnav tenantId={tenantId} buildingId={buildingId} />

      <AutomationQADashboard tenantId={tenantId} buildingId={buildingId} />
    </div>
  );
}
