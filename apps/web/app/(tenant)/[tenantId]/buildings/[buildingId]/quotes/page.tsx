'use client';

import { useParams } from 'next/navigation';
import { BuildingBreadcrumb } from '@/features/buildings/components/BuildingBreadcrumb';
import { BuildingSubnav } from '@/features/buildings/components/BuildingSubnav';
import { QuotesList } from '@/features/buildings/components/vendors';

type BuildingParams = {
  tenantId: string;
  buildingId: string;
};

export default function QuotesPage() {
  const params = useParams<BuildingParams>();
  const tenantId = params?.tenantId;
  const buildingId = params?.buildingId;

  if (!tenantId || !buildingId) {
    return <div>Invalid parameters</div>;
  }

  return (
    <div className="space-y-6">
      <BuildingBreadcrumb tenantId={tenantId} buildingName="Presupuestos" buildingId={buildingId} />
      <BuildingSubnav tenantId={tenantId} buildingId={buildingId} />
      <QuotesList buildingId={buildingId} />
    </div>
  );
}
