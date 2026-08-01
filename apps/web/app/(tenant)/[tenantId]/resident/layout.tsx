'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useParams, useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useHasRole, useAuthSession } from '../../../../features/auth/useAuthSession';
import { getSession } from '../../../../features/auth/session.storage';
import { useBoStorageTick } from '../../../../shared/lib/storage/useBoStorage';
import { ResidentContextSwitcher } from '../../../../features/resident/components/ResidentContextSwitcher';

interface TenantParams { tenantId?: string; [key: string]: string | string[] | undefined; }

interface ResidentLayoutProps { children: ReactNode }

const ResidentLayout = ({ children }: ResidentLayoutProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
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
        const next = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
        router.replace(`/login?next=${encodeURIComponent(next)}`);
      }
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [pathname, router, searchParams, session, storageTick]);

  return (
    <div className="space-y-6">
      {session && isResident && (
        <ResidentContextSwitcher tenantId={tenantId} />
      )}
      {children}
    </div>
  );
};

export default ResidentLayout;
