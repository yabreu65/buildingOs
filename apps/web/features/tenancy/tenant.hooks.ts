 "use client";
 import { useParams, useRouter } from "next/navigation";
 import { getSession, setLastTenant, setSession } from "../auth/session.storage";
 
 export function useTenantId() {
   const params = useParams();
   return params?.tenantId as string | undefined;
 }
 
 export function useEnsureTenantAccess() {
  const router = useRouter();
  const tenantId = useTenantId();
  const session = getSession();
  const hasAccess = session?.memberships.some((m) => m.tenantId === tenantId);

  if (!tenantId || !session || !hasAccess) {
    router.replace("/login");
    return null;
  }
  setLastTenant(tenantId);
  return tenantId;
}

export function setActiveTenant(tenantId: string) {
  const s = getSession();
  if (!s) return;
  setSession({ ...s, activeTenantId: tenantId });
  setLastTenant(tenantId);
}
