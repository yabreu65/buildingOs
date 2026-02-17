'use client';

import { useParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { routes } from '@/shared/lib/routes';
import EmptyState from '@/shared/components/ui/EmptyState';
import { BuildingBreadcrumb, BuildingSubnav } from '@/features/buildings/components';
import { Users } from 'lucide-react';

type BuildingParams = {
  tenantId: string;
  buildingId: string;
};

/**
 * ResidentsPage: Placeholder for resident management
 */
export default function ResidentsPage() {
  const params = useParams<BuildingParams>();
  const tenantId = params?.tenantId;
  const buildingId = params?.buildingId;
  const router = useRouter();

  if (!tenantId || !buildingId) {
    return <div>Invalid parameters</div>;
  }

  return (
    <div className="space-y-6">
      <BuildingBreadcrumb
        tenantId={tenantId}
        buildingName="Residents"
        buildingId={buildingId}
      />

      <BuildingSubnav tenantId={tenantId} buildingId={buildingId} />

      <EmptyState
        icon={<Users className="w-12 h-12 text-muted-foreground" />}
        title="Residents"
        description="Resident management coming soon. You can assign occupants to individual units from the Units section."
        cta={{
          text: 'Go to Units',
          onClick: () => router.push(routes.buildingUnits(tenantId, buildingId)),
        }}
      />
    </div>
  );
}
