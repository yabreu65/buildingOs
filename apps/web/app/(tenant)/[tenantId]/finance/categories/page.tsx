'use client';

import { useParams } from 'next/navigation';
import { ExpenseLedgerCategoriesManager } from '@/features/finance/components';

interface Params {
  tenantId: string;
  [key: string]: string | string[];
}

/**
 * Tenant-level Categories page (Rubros)
 * Canonical route: /:tenantId/finance/categories
 */
export default function TenantCategoriesPage() {
  const params = useParams<Params>();
  const tenantId = params?.tenantId;

  if (!tenantId) {
    return <div>Invalid parameters</div>;
  }

  return (
    <div className="space-y-6">
      <ExpenseLedgerCategoriesManager tenantId={tenantId} defaultScopeFilter="CONDOMINIUM_COMMON" />
    </div>
  );
}
