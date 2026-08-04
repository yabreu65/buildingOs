'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useActiveTenantId } from '@/features/auth/useAuthSession';
import { useAuthorizedPortalContext } from '@/features/auth/useAuthorizedPortalContext';
import { useCanAdministerTenant } from '@/features/tenancy/hooks/useEffectiveRole';
import { useTenantId } from '@/features/tenancy/tenant.hooks';
import BankingUI from '@/features/banking/banking.ui';
import { routes } from '@/shared/lib/routes';

interface BankingSettingsContentProps {
  readonly tenantId: string;
}

function BankingSettingsContent({ tenantId }: BankingSettingsContentProps) {
  return (
    <div className="max-w-4xl mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Cuentas bancarias</h1>
        <p className="mt-2 text-muted-foreground">
          Estas cuentas se mostrarán a residentes para reportar pagos.
        </p>
      </div>

      <BankingUI key={tenantId} tenantId={tenantId} />
    </div>
  );
}

export default function BankingPage() {
  const router = useRouter();
  const routeTenantId = useTenantId();
  const activeTenantId = useActiveTenantId();
  const portalContext = useAuthorizedPortalContext(routeTenantId);

  const hasMatchingTenant =
    activeTenantId !== null &&
    routeTenantId !== null &&
    activeTenantId === routeTenantId;
  const tenantId = hasMatchingTenant ? activeTenantId : null;
  const canAdministerTenant = useCanAdministerTenant(tenantId ?? undefined);

  useEffect(() => {
    if (activeTenantId && routeTenantId && activeTenantId !== routeTenantId) {
      router.replace(`/${activeTenantId}/settings/banking`);
      return;
    }

    if (portalContext === 'resident' && tenantId) {
      router.replace(routes.residentDashboard(tenantId));
    }
  }, [activeTenantId, portalContext, routeTenantId, router, tenantId]);

  if (!tenantId || portalContext === null) {
    return <div className="max-w-4xl mx-auto py-8" aria-busy="true" />;
  }

  if (portalContext === 'resident') {
    return <div className="max-w-4xl mx-auto py-8" aria-busy="true" />;
  }

  if (!canAdministerTenant) {
    return (
      <div className="max-w-4xl mx-auto py-8">
        <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 p-6 text-sm text-muted-foreground">
          No tenés permiso para editar las cuentas bancarias.
        </div>
      </div>
    );
  }

  return <BankingSettingsContent key={tenantId} tenantId={tenantId} />;
}
