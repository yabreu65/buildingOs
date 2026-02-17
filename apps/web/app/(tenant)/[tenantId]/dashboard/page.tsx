'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Card from "@/shared/components/ui/Card";
import Skeleton from "@/shared/components/ui/Skeleton";
import OnboardingChecklist from "@/features/onboarding/OnboardingChecklist";
import { useContextAware } from "@/features/buildings/hooks/useContextAware";
import { useAuthSession, useIsSuperAdmin } from "@/features/auth/useAuthSession";
import { useEffectiveRole } from "@/features/tenancy/hooks/useEffectiveRole";
import TenantAdminDashboard from "@/features/dashboard/components/TenantAdminDashboard";
import OperatorDashboard from "@/features/dashboard/components/OperatorDashboard";
import ResidentDashboard from "@/features/dashboard/components/ResidentDashboard";

export default function DashboardPage() {
  const router = useRouter();
  const { tenantId, isReady } = useContextAware();
  const session = useAuthSession();
  const effectiveRole = useEffectiveRole(tenantId);
  const isSuperAdmin = useIsSuperAdmin();

  // SUPER_ADMIN users should NOT access tenant-level dashboard
  // Redirect them to their control plane
  useEffect(() => {
    if (isSuperAdmin && isReady) {
      router.replace('/super-admin');
    }
  }, [isSuperAdmin, isReady, router]);

  if (!isReady || !session || !tenantId || isSuperAdmin) {
    return (
      <div className="space-y-8">
        <Card>
          <Skeleton className="h-8 w-48 mb-4" />
          <Skeleton className="h-24" />
        </Card>
      </div>
    );
  }

  if (!effectiveRole) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <h3 className="text-lg font-semibold text-amber-900">No Access</h3>
        <p className="text-sm text-amber-700 mt-2">
          You don't have a role in this tenant. Contact your administrator.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <OnboardingChecklist />

      {effectiveRole === 'TENANT_OWNER' || effectiveRole === 'TENANT_ADMIN' ? (
        <TenantAdminDashboard
          tenantId={tenantId}
          role={effectiveRole}
        />
      ) : effectiveRole === 'OPERATOR' ? (
        <OperatorDashboard tenantId={tenantId} />
      ) : (
        <ResidentDashboard tenantId={tenantId} userId={session.user.id} />
      )}
    </div>
  );
}
