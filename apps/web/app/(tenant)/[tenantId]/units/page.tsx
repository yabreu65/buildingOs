'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthorizedPortalContext } from '@/features/auth/useAuthorizedPortalContext';
import { UnitsUI } from "../../../../features/units/units.ui";

const UnitsPage = () => {
  const params = useParams();
  const tenantId = params?.tenantId as string;
  const router = useRouter();
  const portalContext = useAuthorizedPortalContext(tenantId);

  useEffect(() => {
    if (portalContext === 'resident' && tenantId) {
      router.replace(`/${tenantId}/resident/dashboard`);
    }
  }, [portalContext, tenantId, router]);

  if (portalContext !== 'admin') {
    return <div aria-busy="true" />;
  }

  return <UnitsUI />;
};

export default UnitsPage;
