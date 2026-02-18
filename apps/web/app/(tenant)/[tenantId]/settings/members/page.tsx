'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/useAuth';
import { useTenantId } from '@/features/tenancy/tenant.hooks';
import { useInvitations } from '@/features/invitations/hooks/useInvitations';
import { useBuildings } from '@/features/buildings/hooks/useBuildings';
import MembersList from '@/features/invitations/components/MembersList';
import PendingInvitationsList from '@/features/invitations/components/PendingInvitationsList';
import InviteModal from '@/features/invitations/components/InviteModal';
import { RolesModal } from '@/features/memberships/components/RolesModal';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { CreateInvitationRequest } from '@/features/invitations/services/invitations.api';

interface MembersPageProps {
  params: {
    tenantId: string;
  };
}

export default function MembersPage({ params }: MembersPageProps) {
  const { tenantId } = params;
  const { currentUser, session, status } = useAuth();
  const pageParamTenantId = useTenantId();
  const {
    members,
    pendingInvitations,
    loading,
    error,
    fetchMembers,
    fetchInvitations,
    createInvitation,
    revokeInvitation,
  } = useInvitations();
  const { buildings, loading: buildingsLoading } = useBuildings(tenantId);

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [rolesModal, setRolesModal] = useState<{
    open: boolean;
    membershipId: string;
    memberName: string;
  }>({
    open: false,
    membershipId: '',
    memberName: '',
  });
  const [toast, setToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Load members and invitations on mount
  useEffect(() => {
    if (tenantId) {
      fetchMembers(tenantId);
      fetchInvitations(tenantId);
    }
  }, [tenantId, fetchMembers, fetchInvitations]);

  // Verify user is authorized
  if (status === 'loading') {
    return <div className="p-4">Carregando...</div>;
  }

  if (status === 'unauthenticated' || !currentUser || !session) {
    return <div className="p-4 text-red-600">Acesso negado</div>;
  }

  const handleCreateInvitation = async (dto: CreateInvitationRequest) => {
    try {
      await createInvitation(tenantId, dto);
      setToast({
        type: 'success',
        message: 'Convite enviado com sucesso!',
      });
      setShowInviteModal(false);
    } catch (err: any) {
      setToast({
        type: 'error',
        message: error || err?.message || 'Erro ao enviar convite',
      });
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    try {
      await revokeInvitation(tenantId, invitationId);
      setToast({
        type: 'success',
        message: 'Convite revogado com sucesso',
      });
    } catch (err: any) {
      setToast({
        type: 'error',
        message: 'Erro ao revogar convite',
      });
    }
  };

  const handleRolesClick = (membershipId: string, memberName: string) => {
    setRolesModal({
      open: true,
      membershipId,
      memberName,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Equipe</h1>
          <p className="text-gray-600 mt-1">
            Gerencie membros e convites pendentes
          </p>
        </div>
        <Button onClick={() => setShowInviteModal(true)}>
          + Convidar Membro
        </Button>
      </div>

      {/* Error state */}
      {error && (
        <Card className="border-red-200 bg-red-50 p-4">
          <p className="text-red-700">{error}</p>
        </Card>
      )}

      {/* Members and Invitations */}
      <div className="grid gap-6">
        <MembersList 
          members={members} 
          loading={loading}
          onRolesClick={handleRolesClick}
        />
        <PendingInvitationsList
          invitations={pendingInvitations}
          loading={loading}
          onRevoke={handleRevokeInvitation}
        />
      </div>

      {/* Invite Modal */}
      <InviteModal
        open={showInviteModal}
        onOpenChange={setShowInviteModal}
        onSubmit={handleCreateInvitation}
      />

      {/* Roles Modal */}
      {rolesModal.open && (
        <RolesModal
          isOpen={rolesModal.open}
          tenantId={tenantId}
          membershipId={rolesModal.membershipId}
          memberName={rolesModal.memberName}
          buildings={buildings.map((b) => ({ id: b.id, name: b.name }))}
          onClose={() =>
            setRolesModal({ open: false, membershipId: '', memberName: '' })
          }
        />
      )}

      {/* Toast notifications */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50">
          <div
            className={[
              'px-4 py-3 rounded-lg shadow-lg flex items-center justify-between',
              toast.type === 'success'
                ? 'bg-green-500 text-white'
                : 'bg-red-500 text-white',
            ].join(' ')}
          >
            <span className="text-sm font-medium">{toast.message}</span>
            <button
              onClick={() => setToast(null)}
              className="ml-4 text-white hover:opacity-80"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
