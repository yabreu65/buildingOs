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
    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4 overflow-x-auto">
      <Link href={routes.tenantDashboard(tenantId)} className="hover:text-foreground transition whitespace-nowrap">
        Inicio
      </Link>
      <ChevronRight className="w-4 h-4 flex-shrink-0" />
      <Link href={routes.buildingsList(tenantId)} className="hover:text-foreground transition whitespace-nowrap">
        Edificios
      </Link>
      {buildingId && buildingName && (
        <>
          <ChevronRight className="w-4 h-4 flex-shrink-0" />
          {sectionName ? (
            <Link
              href={`/${tenantId}/buildings/${buildingId}`}
              className="hover:text-foreground transition whitespace-nowrap max-w-[200px] truncate"
            >
              {buildingName}
            </Link>
          ) : (
            <span className="text-foreground font-medium whitespace-nowrap max-w-[200px] truncate">{buildingName}</span>
          )}
        </>
      )}
      {sectionName && (
        <>
          <ChevronRight className="w-4 h-4 flex-shrink-0" />
          <span className="text-foreground font-medium whitespace-nowrap">{sectionName}</span>
        </>
      )}
    </div>
  );
}
