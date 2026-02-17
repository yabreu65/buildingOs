'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { routes } from '@/shared/lib/routes';

interface BuildingBreadcrumbProps {
  tenantId: string;
  buildingName?: string;
  buildingId?: string;
}

/**
 * BuildingBreadcrumb: Show navigation path
 * Tenant > Buildings > [Building Name]
 */
export function BuildingBreadcrumb({
  tenantId,
  buildingName,
  buildingId,
}: BuildingBreadcrumbProps) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
      <Link href={routes.tenantDashboard(tenantId)} className="hover:text-foreground transition">
        Tenant
      </Link>
      <ChevronRight className="w-4 h-4" />
      <Link href={routes.buildingsList(tenantId)} className="hover:text-foreground transition">
        Buildings
      </Link>
      {buildingId && buildingName && (
        <>
          <ChevronRight className="w-4 h-4" />
          <span className="text-foreground font-medium">{buildingName}</span>
        </>
      )}
    </div>
  );
}
