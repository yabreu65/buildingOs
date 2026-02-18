'use client';

import { useState } from 'react';
import { PendingInvitation } from '../services/invitations.api';
import Card from '@/shared/components/ui/Card';
import Button from '@/shared/components/ui/Button';
import Badge from '@/shared/components/ui/Badge';
import Skeleton from '@/shared/components/ui/Skeleton';
import EmptyState from '@/shared/components/ui/EmptyState';

interface PendingInvitationsListProps {
  invitations: PendingInvitation[];
  loading: boolean;
  onRevoke: (invitationId: string) => Promise<void>;
}

export default function PendingInvitationsList({
  invitations,
  loading,
  onRevoke,
}: PendingInvitationsListProps) {
  const [revoking, setRevoking] = useState<string | null>(null);

  if (loading) {
    return (
      <Card>
        <div className="mb-4">
          <h3 className="text-lg font-semibold">Convites Pendentes</h3>
        </div>
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-16 rounded" />
          ))}
        </div>
      </Card>
    );
  }

  if (invitations.length === 0) {
    return (
      <Card>
        <div className="mb-4">
          <h3 className="text-lg font-semibold">Convites Pendentes</h3>
        </div>
        <EmptyState
          title="Nenhum convite pendente"
          description="Todos os convites foram aceitos ou expirados"
        />
      </Card>
    );
  }

  const handleRevoke = async (invitationId: string) => {
    try {
      setRevoking(invitationId);
      await onRevoke(invitationId);
    } finally {
      setRevoking(null);
    }
  };

  return (
    <Card>
      <div className="mb-4 flex justify-between items-center">
        <h3 className="text-lg font-semibold">
          Convites Pendentes ({invitations.length})
        </h3>
      </div>
      <div className="space-y-4">
        {invitations.map((invitation) => (
          <div
            key={invitation.id}
            className="flex items-center justify-between p-3 border rounded-lg"
          >
            <div className="flex-1">
              <p className="font-medium">{invitation.email}</p>
              <div className="flex gap-2 mt-2">
                {invitation.roles.map((role) => (
                  <Badge key={role} className="bg-blue-100 text-blue-700 border border-blue-300">
                    {role}
                  </Badge>
                ))}
              </div>
              <p className="text-sm text-gray-400 mt-2">
                Expira em{' '}
                {new Date(invitation.expiresAt).toLocaleDateString()}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleRevoke(invitation.id)}
              disabled={revoking === invitation.id}
            >
              {revoking === invitation.id ? 'Revogando...' : 'Revogar'}
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
