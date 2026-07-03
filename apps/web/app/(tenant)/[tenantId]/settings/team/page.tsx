'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { Role } from '@buildingos/contracts';
import { useHasRole } from '@/features/auth/useAuthSession';
import { OperationalMembersList } from '@/features/memberships/components/OperationalMembersList';
import { PeopleModuleSwitcher } from '@/features/memberships/components/PeopleModuleSwitcher';
import { InviteModal } from '@/features/invitations/components/InviteModal';
import PendingInvitationsList from '@/features/invitations/components/PendingInvitationsList';
import { useInvitations } from '@/features/invitations/hooks/useInvitations';
import type { CreateInvitationRequest } from '@/features/invitations/services/invitations.api';
import Button from '@/shared/components/ui/Button';
import { useToast } from '@/shared/components/ui/Toast';

const operationalInviteRoles: readonly Role[] = ['TENANT_ADMIN', 'OPERATOR'];

const TeamPage = () => {
  const params = useParams();
  const tenantId = typeof params.tenantId === 'string' && params.tenantId.length > 0
    ? params.tenantId
    : null;
  const router = useRouter();
  const isResident = useHasRole('RESIDENT');
  const { toast } = useToast();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const {
    pendingInvitations,
    loading: invitationsLoading,
    fetchInvitations,
    createInvitation,
    revokeInvitation,
    resendInvitation,
  } = useInvitations();

  useEffect(() => {
    if (isResident && tenantId) {
      router.replace(`/${tenantId}/dashboard`);
    }
  }, [isResident, tenantId, router]);

  useEffect(() => {
    if (tenantId && !isResident) {
      void fetchInvitations(tenantId);
    }
  }, [tenantId, isResident, fetchInvitations]);

  const handleInvite = async (dto: CreateInvitationRequest) => {
    if (!tenantId) {
      return;
    }
    await createInvitation(tenantId, dto);
    toast('Invitación enviada', 'success');
    setShowInviteModal(false);
  };

  if (!tenantId || isResident) {
    return <div className="container mx-auto max-w-4xl py-8" />;
  }

  return (
    <div className="container mx-auto max-w-4xl py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Administración de personas
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Equipo operativo</h1>
          <p className="text-sm text-muted-foreground">
            Administradores y operadores que pueden atender solicitudes y aparecer en “Asignar a”.
          </p>
        </div>

        <Button onClick={() => setShowInviteModal(true)}>
          Invitar miembro operativo
        </Button>
      </div>

      <PeopleModuleSwitcher tenantId={tenantId} active="team" />

      <OperationalMembersList tenantId={tenantId} />

      <div className="mt-8">
        <PendingInvitationsList
          invitations={pendingInvitations}
          loading={invitationsLoading}
          onRevoke={async (invitationId) => {
            await revokeInvitation(tenantId, invitationId);
            toast('Invitación revocada', 'success');
          }}
          onResend={async (invitationId) => {
            await resendInvitation(tenantId, invitationId);
            toast('Invitación reenviada', 'success');
          }}
        />
      </div>

      <InviteModal
        open={showInviteModal}
        onOpenChange={setShowInviteModal}
        onSubmit={handleInvite}
        availableRoles={operationalInviteRoles}
        title="Invitar miembro operativo"
        subtitle="Envía una invitación para agregar administradores u operadores al equipo."
        submitLabel="Enviar invitación"
      />
    </div>
  );
};

export default TeamPage;
