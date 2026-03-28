'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useHasRole, useAuthSession } from '../../../../features/auth/useAuthSession';
import { getToken } from '../../../../features/auth/session.storage';

interface TenantParams { tenantId?: string; [key: string]: string | string[] | undefined; }

interface ResidentLayoutProps { children: ReactNode }

const ResidentLayout = ({ children }: ResidentLayoutProps) => {
  const router = useRouter();
  const params = useParams<TenantParams>();
  const tenantId = params?.tenantId ?? '';
  const session = useAuthSession();
  const isResident = useHasRole('RESIDENT');

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    if (!session) return;
    if (!isResident) {
      router.replace(`/${tenantId}/dashboard`);
    }
  }, [session, isResident, tenantId, router]);

  return <>{children}</>;
};

export default ResidentLayout;
