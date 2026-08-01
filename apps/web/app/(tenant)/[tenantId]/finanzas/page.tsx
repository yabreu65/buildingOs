'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { TenantFinanceDashboard } from '@/features/finance/components';
import { useAuthorizedPortalContext } from '@/features/auth/useAuthorizedPortalContext';

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
  const portalContext = useAuthorizedPortalContext(tenantId);

  useEffect(() => {
    if (portalContext === 'resident' && tenantId) {
      router.replace(`/${tenantId}/resident/dashboard`);
    }
  }, [portalContext, tenantId, router]);

  if (!tenantId) {
    return <div>Invalid parameters</div>;
  }

  if (portalContext !== 'admin') {
    return <div aria-busy="true" />;
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
