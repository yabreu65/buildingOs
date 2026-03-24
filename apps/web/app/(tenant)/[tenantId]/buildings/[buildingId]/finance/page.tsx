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
  const params = useParams();
  const { tenantId, buildingId } = params as unknown as BuildingParams;
  const tenantIdStr = typeof tenantId === 'string' ? tenantId : undefined;
  const buildingIdStr = typeof buildingId === 'string' ? buildingId : undefined;

  if (!tenantIdStr || !buildingIdStr) {
    return <div>Invalid parameters</div>;
  }

  return (
    <div className="space-y-6">
      <BuildingBreadcrumb
        tenantId={tenantIdStr}
        buildingName="Finanzas"
        buildingId={buildingIdStr}
      />

      <BuildingSubnav tenantId={tenantIdStr} buildingId={buildingIdStr} />

      <FinanceDashboard buildingId={buildingIdStr} tenantId={tenantIdStr} />
    </div>
  );
}
