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
  onResend?: (invitationId: string) => Promise<void>;
}

const ROLE_LABELS: Record<string, string> = {
  TENANT_OWNER: 'Propietario',
  TENANT_ADMIN: 'Administrador',
  OPERATOR: 'Operador',
  RESIDENT: 'Residente',
};

export default function PendingInvitationsList({
  invitations,
  loading,
  onRevoke,
  onResend,
}: PendingInvitationsListProps) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);

  if (loading) {
    return (
      <Card>
        <div className="mb-4 space-y-1">
          <h3 className="text-lg font-semibold">Invitaciones del equipo operativo</h3>
          <p className="text-sm text-muted-foreground">
            Invitaciones enviadas y todavía no aceptadas.
          </p>
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
        <div className="mb-4 space-y-1">
          <h3 className="text-lg font-semibold">Invitaciones del equipo operativo</h3>
          <p className="text-sm text-muted-foreground">
            Invitaciones enviadas y todavía no aceptadas.
          </p>
        </div>
        <EmptyState
          title="No hay invitaciones pendientes"
          description="Todas las invitaciones fueron aceptadas o ya expiraron."
        />
      </Card>
    );
  }

  const formatTimeUntilExpiry = (expiresAt: string): string => {
    const now = new Date();
    const expiryDate = new Date(expiresAt);
    const hoursUntil = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60));

    if (hoursUntil <= 0) {
      return 'Expirado';
    }
    if (hoursUntil < 24) {
      return `${hoursUntil}h restantes`;
    }
    const daysUntil = Math.floor(hoursUntil / 24);
    return `${daysUntil}d restantes`;
  };

  const handleRevoke = async (invitationId: string) => {
    try {
      setRevoking(invitationId);
      await onRevoke(invitationId);
    } finally {
      setRevoking(null);
    }
  };

  const handleResend = async (invitationId: string) => {
    if (!onResend) return;
    try {
      setResending(invitationId);
      await onResend(invitationId);
    } finally {
      setResending(null);
    }
  };

  return (
    <Card>
      <div className="mb-4 space-y-1">
        <h3 className="text-lg font-semibold">
          Invitaciones del equipo operativo ({invitations.length})
        </h3>
        <p className="text-sm text-muted-foreground">
          Invitaciones enviadas y todavía no aceptadas.
        </p>
      </div>
      <div className="space-y-4">
        {invitations.map((invitation) => (
          <div
            key={invitation.id}
            className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3"
          >
          <div className="flex-1">
            <p className="font-medium">{invitation.email}</p>
            <p className="text-sm text-muted-foreground mt-1">Pendiente de aceptación</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {invitation.roles.map((role) => (
                <Badge key={role} className="border border-border bg-primary/10 text-primary">
                  {ROLE_LABELS[role] ?? role}
                </Badge>
              ))}
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Invitado como:{' '}
              {invitation.roles.map((role) => ROLE_LABELS[role] ?? role).join(', ')}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {formatTimeUntilExpiry(invitation.expiresAt)} (
              {new Date(invitation.expiresAt).toLocaleDateString()})
            </p>
          </div>
          <div className="flex gap-2">
            {onResend && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleResend(invitation.id)}
                disabled={resending === invitation.id || revoking === invitation.id}
              >
                {resending === invitation.id ? 'Reenviando...' : 'Reenviar'}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleRevoke(invitation.id)}
              disabled={revoking === invitation.id || resending === invitation.id}
              className="text-red-500 hover:bg-red-500/10"
            >
              {revoking === invitation.id ? 'Revocando...' : 'Revocar'}
            </Button>
          </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
