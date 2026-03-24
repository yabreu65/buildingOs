'use client';

import { useParams } from 'next/navigation';
import { BuildingBreadcrumb, BuildingSubnav } from '@/features/buildings/components';
import { FinanceDashboard } from '@/features/buildings/components/finance';

interface BuildingParams {
  tenantId: string;
  buildingId: string;
}

/**
 * FinancePage: Display financial dashboard for a building
 */
export default function FinancePage() {
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
        buildingName="Finanzas"
        buildingId={buildingId}
      />

      <BuildingSubnav tenantId={tenantId} buildingId={buildingId} />

      <FinanceDashboard buildingId={buildingId} tenantId={tenantId} />
    </div>
  );
}
