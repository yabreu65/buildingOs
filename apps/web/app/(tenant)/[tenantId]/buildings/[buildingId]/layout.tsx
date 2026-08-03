'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthorizedPortalContext } from '@/features/auth/useAuthorizedPortalContext';
import { routes } from '@/shared/lib/routes';

interface BuildingRouteParams {
  tenantId?: string;
  buildingId?: string;
  [key: string]: string | string[] | undefined;
}

interface BuildingAdminLayoutProps {
  children: ReactNode;
}

export default function BuildingAdminLayout({ children }: BuildingAdminLayoutProps) {
  const router = useRouter();
  const params = useParams<BuildingRouteParams>();
  const tenantId = typeof params?.tenantId === 'string' ? params.tenantId.trim() : '';
  const portalContext = useAuthorizedPortalContext(tenantId || null);

  useEffect(() => {
    if (portalContext === 'resident' && tenantId) {
      router.replace(routes.residentDashboard(tenantId));
    }
  }, [portalContext, router, tenantId]);

  if (portalContext !== 'admin') {
    return <div className="min-h-screen bg-background" aria-busy="true" />;
  }

  return <>{children}</>;
}
