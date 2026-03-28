'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { routes } from '@/shared/lib/routes';

interface BuildingBreadcrumbProps {
  tenantId: string;
  buildingName?: string;
  buildingId?: string;
  sectionName?: string;
}

/**
 * BuildingBreadcrumb: Show navigation path
 * Inicio > Edificios > [Building Name] > [Section]
 */
export function BuildingBreadcrumb({
  tenantId,
  buildingName,
  buildingId,
  sectionName,
}: BuildingBreadcrumbProps) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
      <Link href={routes.tenantDashboard(tenantId)} className="hover:text-foreground transition">
        Inicio
      </Link>
      <ChevronRight className="w-4 h-4" />
      <Link href={routes.buildingsList(tenantId)} className="hover:text-foreground transition">
        Edificios
      </Link>
      {buildingId && buildingName && (
        <>
          <ChevronRight className="w-4 h-4" />
          {sectionName ? (
            <Link
              href={`/${tenantId}/buildings/${buildingId}`}
              className="hover:text-foreground transition"
            >
              {buildingName}
            </Link>
          ) : (
            <span className="text-foreground font-medium">{buildingName}</span>
          )}
        </>
      )}
      {sectionName && (
        <>
          <ChevronRight className="w-4 h-4" />
          <span className="text-foreground font-medium">{sectionName}</span>
        </>
      )}
    </div>
  );
}
