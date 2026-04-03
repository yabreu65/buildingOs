'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ExpenseLedgerCategoriesManager } from '@/features/finance/components';
import { fetchBuildingById } from '@/features/buildings/services/buildings.api';
import { useEffect, useState } from 'react';

interface Params {
  tenantId: string;
  buildingId: string;
  [key: string]: string | string[];
}

/**
 * Building Categories shortcut page
 * Route: /:tenantId/buildings/:buildingId/finance/categories
 * Renders same component as tenant-level but with building context for navigation
 */
export default function BuildingCategoriesPage() {
  const { tenantId, buildingId } = useParams<Params>();
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
      {/* Breadcrumb with building context */}
      <div className="flex items-center gap-2 text-sm">
        <Link href={`/${tenantIdStr}`} className="text-primary hover:underline">
          Dashboard
        </Link>
        <span className="text-muted-foreground">/</span>
        <Link href={`/${tenantIdStr}/buildings`} className="text-primary hover:underline">
          Edificios
        </Link>
        <span className="text-muted-foreground">/</span>
        <Link
          href={`/${tenantIdStr}/buildings/${buildingIdStr}`}
          className="text-primary hover:underline"
        >
          {buildingName || buildingIdStr}
        </Link>
        <span className="text-muted-foreground">/</span>
        <Link
          href={`/${tenantIdStr}/buildings/${buildingIdStr}/finance`}
          className="text-primary hover:underline"
        >
          Finanzas
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-muted-foreground">Rubros</span>
      </div>

      {/* Same categories manager component - source of truth */}
      <ExpenseLedgerCategoriesManager tenantId={tenantIdStr} defaultScopeFilter="BUILDING" />
    </div>
  );
}
