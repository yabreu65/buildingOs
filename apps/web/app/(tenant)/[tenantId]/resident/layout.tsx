'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useHasRole, useAuthSession } from '../../../../features/auth/useAuthSession';
import { getSession } from '../../../../features/auth/session.storage';
import { useBoStorageTick } from '../../../../shared/lib/storage/useBoStorage';

interface TenantParams { tenantId?: string; [key: string]: string | string[] | undefined; }

interface ResidentLayoutProps { children: ReactNode }

const ResidentLayout = ({ children }: ResidentLayoutProps) => {
  const router = useRouter();
  const params = useParams<TenantParams>();
  const tenantId = params?.tenantId ?? '';
  const session = useAuthSession();
  const isResident = useHasRole('RESIDENT');
  const storageTick = useBoStorageTick();

  useEffect(() => {
    if (!session) return;
    if (!isResident) {
      router.replace(`/${tenantId}/dashboard`);
    }
  }, [session, isResident, tenantId, router, storageTick]);

  useEffect(() => {
    if (session) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (!getSession()) {
        router.replace('/login');
      }
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [session, router, storageTick]);

  return <>{children}</>;
};

export default ResidentLayout;
