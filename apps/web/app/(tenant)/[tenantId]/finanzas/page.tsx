'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { TenantFinanceDashboard } from '@/features/finance/components';
import { useHasRole } from '@/features/auth/useAuthSession';

interface Params {
  tenantId: string;
  [key: string]: string | string[];
}

/**
 * TenantFinanzasPage: Display aggregated financial dashboard for entire tenant
 * Shows summary across all buildings
 */
const TenantFinanzasPage = () => {
  const params = useParams<Params>();
  const tenantId = params?.tenantId;
  const router = useRouter();
  const isResident = useHasRole('RESIDENT');

  useEffect(() => {
    if (isResident && tenantId) {
      router.replace(`/${tenantId}/dashboard`);
    }
  }, [isResident, tenantId, router]);

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
};

export default TenantFinanzasPage;
