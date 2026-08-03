'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { resolveAuthorizedPortalContext, type PortalContext } from './landing-route';
import { useAuthSession } from './useAuthSession';
import { getLastPortal } from './session.storage';

export function useAuthorizedPortalContext(tenantId: string | null | undefined): PortalContext | null {
  const session = useAuthSession();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return resolveAuthorizedPortalContext({
    session,
    tenantId: typeof tenantId === 'string' && tenantId.trim().length > 0 ? tenantId.trim() : null,
    pathname,
    searchParamsString: searchParams.toString(),
    preferredPortal: getLastPortal(),
  });
}
