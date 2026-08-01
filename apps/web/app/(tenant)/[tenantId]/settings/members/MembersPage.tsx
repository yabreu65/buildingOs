'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useActiveTenantId } from '@/features/auth/useAuthSession';
import { useAuthorizedPortalContext } from '@/features/auth/useAuthorizedPortalContext';
import { useCan } from '@/features/rbac/rbac.hooks';
import { MembersList } from '@/features/tenant-members/components/MembersList';
import { CreateMemberModal } from '@/features/tenant-members/components/CreateMemberModal';
import { PeopleModuleSwitcher } from '@/features/memberships/components/PeopleModuleSwitcher';

interface MembersPageContentProps {
  tenantId: string;
}

const MembersPageContent = ({ tenantId }: MembersPageContentProps) => {
  const canManageMembers = useCan('members.manage');
  const [showCreateModal, setShowCreateModal] = useState(false);

  return (
    <div className="container max-w-4xl mx-auto py-8">
      <div className="mb-6 space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Administración de personas
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Residentes del edificio</h1>
        <p className="text-sm text-muted-foreground">
          Gestiona las personas vinculadas a las unidades del edificio. No se usan para asignar tickets.
        </p>
      </div>

      <PeopleModuleSwitcher tenantId={tenantId} active="residents" />

      {canManageMembers ? (
        <MembersList tenantId={tenantId} onCreateClick={() => setShowCreateModal(true)} />
      ) : (
        <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 p-6 text-sm text-muted-foreground">
          No tenés permiso para ver el directorio de residentes.
        </div>
      )}

      {showCreateModal && canManageMembers && (
        <CreateMemberModal
          tenantId={tenantId}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
};

export const MembersPage = () => {
  const params = useParams();
  const routeTenantId = typeof params.tenantId === 'string' && params.tenantId.length > 0
    ? params.tenantId
    : null;
  const router = useRouter();
  const activeTenantId = useActiveTenantId();
  const portalContext = useAuthorizedPortalContext(routeTenantId);
  const hasMatchingTenant =
    activeTenantId !== null &&
    routeTenantId !== null &&
    activeTenantId === routeTenantId;
  const tenantId = hasMatchingTenant ? activeTenantId : null;

  useEffect(() => {
    if (activeTenantId && routeTenantId && activeTenantId !== routeTenantId) {
      router.replace(`/${activeTenantId}/settings/members`);
      return;
    }

    if (portalContext === 'resident' && tenantId) {
      router.replace(`/${tenantId}/resident/dashboard`);
    }
  }, [activeTenantId, portalContext, routeTenantId, router, tenantId]);

  if (!tenantId || portalContext !== 'admin') {
    return <div className="container mx-auto max-w-4xl py-8" aria-busy="true" />;
  }

  return <MembersPageContent key={tenantId} tenantId={tenantId} />;
};
