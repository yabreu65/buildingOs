'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useHasRole } from '@/features/auth/useAuthSession';
import { UnitsUI } from "../../../../features/units/units.ui";

const UnitsPage = () => {
  const params = useParams();
  const tenantId = params?.tenantId as string;
  const router = useRouter();
  const isResident = useHasRole('RESIDENT');

  useEffect(() => {
    if (isResident && tenantId) {
      router.replace(`/${tenantId}/dashboard`);
    }
  }, [isResident, tenantId, router]);

  return <UnitsUI />;
};

export default UnitsPage;
