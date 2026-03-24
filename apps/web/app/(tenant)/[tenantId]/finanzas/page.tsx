'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { TenantFinanceDashboard } from '@/features/finance/components';

interface Params {
  tenantId: string;
  [key: string]: string | string[];
}

/**
 * TenantFinanzasPage: Display aggregated financial dashboard for entire tenant
 * Shows summary across all buildings
 */
export default function TenantFinanzasPage() {
  const params = useParams<Params>();
  const tenantId = params?.tenantId;

  if (!tenantId) {
    return <div>Invalid parameters</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <Link href={`/${tenantId}`} className="text-primary hover:underline">
          Dashboard
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-muted-foreground">Finanzas</span>
      </div>

      <TenantFinanceDashboard />
    </div>
  );
}
