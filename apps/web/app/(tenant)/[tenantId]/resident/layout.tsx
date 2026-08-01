'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useParams, useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useAuthSession } from '../../../../features/auth/useAuthSession';
import { useAuthorizedPortalContext } from '../../../../features/auth/useAuthorizedPortalContext';
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
  const portalContext = useAuthorizedPortalContext(tenantId);
  const storageTick = useBoStorageTick();

  useEffect(() => {
    if (!session) return;
    if (portalContext !== 'resident') {
      router.replace(`/${tenantId}/dashboard`);
    }
  }, [session, portalContext, tenantId, router, storageTick]);

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
      {session && portalContext === 'resident' && (
        <ResidentContextSwitcher tenantId={tenantId} />
      )}
      {children}
    </div>
  );
};

export default ResidentLayout;
