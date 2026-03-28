'use client';

import { useState } from 'react';
import { Mail, Phone, Trash2, Send } from 'lucide-react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { useToast } from '@/shared/components/ui/Toast';
import { useTenantMembers, useInviteTenantMember, useDeleteTenantMember } from '../hooks/useTenantMembers';

interface MembersListProps {
  tenantId: string;
  onCreateClick: () => void;
}

export const MembersList = ({ tenantId, onCreateClick }: MembersListProps) => {
  const { toast } = useToast();
  const { data: members = [], isLoading } = useTenantMembers(tenantId);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const inviteMutation = useInviteTenantMember(tenantId, selectedMemberId || '');
  const deleteMutation = useDeleteTenantMember(tenantId, deletingId || '');

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { bg: string; text: string; label: string }> = {
      DRAFT: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Borrador' },
      PENDING_INVITE: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Invitación Pendiente' },
      ACTIVE: { bg: 'bg-green-100', text: 'text-green-700', label: 'Activo' },
      DISABLED: { bg: 'bg-red-100', text: 'text-red-700', label: 'Deshabilitado' },
    };
    const badge = badges[status] || badges.DRAFT;
    return (
      <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
        {badge.label}
      </span>
    );
  };

  const handleInvite = async (memberId: string) => {
    setInvitingId(memberId);
    setSelectedMemberId(memberId);
    try {
      await inviteMutation.mutateAsync(true);
      toast('Invitación enviada', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al invitar';
      toast(message, 'error');
    } finally {
      setInvitingId(null);
      setSelectedMemberId(null);
    }
  };

  const handleDelete = async (memberId: string) => {
    if (!confirm('¿Estás seguro de que deseas eliminar este miembro?')) {
      return;
    }

    setDeletingId(memberId);
    try {
      await deleteMutation.mutateAsync();
      toast('Miembro eliminado correctamente', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al eliminar';
      toast(message, 'error');
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return <div className="py-8 text-center text-muted-foreground">Cargando miembros...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Miembros del Tenant</h2>
        <Button onClick={onCreateClick}>+ Crear Miembro</Button>
      </div>

      {members.length === 0 ? (
        <Card className="py-8 text-center">
          <p className="text-muted-foreground mb-4">No hay miembros creados</p>
          <Button onClick={onCreateClick}>Crear Primer Miembro</Button>
        </Card>
      ) : (
        <div className="grid gap-4">
          {members.map((member) => (
            <Card key={member.id} className="p-4">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold text-lg">{member.name}</h3>
                    {getStatusBadge(member.status)}
                  </div>

                  <div className="space-y-1 text-sm text-muted-foreground">
                    {member.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4" />
                        {member.email}
                      </div>
                    )}
                    {member.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="w-4 h-4" />
                        {member.phone}
                      </div>
                    )}
                    <div>
                      <strong>Rol:</strong> {member.role}
                    </div>
                    {member.notes && (
                      <div>
                        <strong>Notas:</strong> {member.notes}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  {member.status !== 'ACTIVE' && member.email && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleInvite(member.id)}
                      disabled={invitingId === member.id}
                      className="flex items-center gap-1"
                    >
                      <Send className="w-4 h-4" />
                      {invitingId === member.id ? 'Invitando...' : 'Invitar'}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleDelete(member.id)}
                    disabled={deletingId === member.id}
                    className="text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
