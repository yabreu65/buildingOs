'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BuildingBreadcrumb, BuildingSubnav } from '@/features/buildings/components';
import { FinanceDashboard } from '@/features/finance/components';
import { fetchBuildingById } from '@/features/buildings/services/buildings.api';

interface BuildingParams {
  tenantId: string;
  buildingId: string;
  [key: string]: string | string[];
}

/**
 * FinancePage: Display financial dashboard for a building
 */
export default function FinancePage() {
  const { tenantId, buildingId } = useParams<BuildingParams>();
  const tenantIdStr = typeof tenantId === 'string' ? tenantId : undefined;
  const buildingIdStr = typeof buildingId === 'string' ? buildingId : undefined;
  const [buildingName, setBuildingName] = useState<string>('');

  useEffect(() => {
    if (!tenantIdStr || !buildingIdStr) return;
    fetchBuildingById(tenantIdStr, buildingIdStr)
      .then((b) => setBuildingName(b.name))
      .catch(() => setBuildingName(''));
  }, [tenantIdStr, buildingIdStr]);

  if (!tenantIdStr || !buildingIdStr) {
    return <div>Invalid parameters</div>;
  }

  return (
    <div className="space-y-6">
      <BuildingBreadcrumb
        tenantId={tenantIdStr}
        buildingName={buildingName}
        buildingId={buildingIdStr}
        sectionName="Finanzas"
      />

      <BuildingSubnav tenantId={tenantIdStr} buildingId={buildingIdStr} />

      <FinanceDashboard buildingId={buildingIdStr} tenantId={tenantIdStr} />
    </div>
  );
}
