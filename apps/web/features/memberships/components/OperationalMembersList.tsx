'use client';

import { useState } from 'react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { useBuildings } from '@/features/buildings/hooks';
import { useAssignableTicketMembers } from '../useAssignableTicketMembers';
import { RolesModal } from './RolesModal';

interface OperationalMembersListProps {
  tenantId: string;
}

const ROLE_LABELS: Record<string, string> = {
  TENANT_OWNER: 'Propietario',
  TENANT_ADMIN: 'Administrador',
  OPERATOR: 'Operador',
  RESIDENT: 'Residente',
};

export function OperationalMembersList({ tenantId }: OperationalMembersListProps) {
  const { data: members = [], isLoading, isError, error } = useAssignableTicketMembers(tenantId);
  const { buildings } = useBuildings(tenantId);
  const [selectedMember, setSelectedMember] = useState<{ membershipId: string; name: string } | null>(null);

  if (isLoading) {
    return <div className="py-8 text-center text-muted-foreground">Cargando equipo operativo...</div>;
  }

  if (isError) {
    return (
      <Card className="py-8 text-center border-red-200 bg-red-50">
        <p className="font-medium text-red-700">No pudimos cargar el equipo operativo.</p>
        <p className="mt-2 text-sm text-red-600">
          {error instanceof Error ? error.message : 'Inténtalo nuevamente en unos segundos.'}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">Miembros operativos</h2>
          <p className="text-sm text-muted-foreground">
            Administradores y operadores que pueden atender solicitudes y ser asignados a tickets.
          </p>
        </div>
        <div className="text-sm text-muted-foreground">
          {members.length} {members.length === 1 ? 'miembro' : 'miembros'}
        </div>
      </div>

      {members.length === 0 ? (
        <Card className="py-8 text-center">
          <p className="text-muted-foreground">No hay miembros operativos registrados.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Los residentes se gestionan en la sección Residentes.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {members.map((member) => (
            <Card key={member.membershipId} className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold">{member.name}</h3>
                    <span className="text-xs rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700">
                      Operativo
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{member.email}</p>
                  <p className="text-sm text-muted-foreground">
                    Puede recibir tickets y gestionar solicitudes del edificio.
                  </p>
                </div>

                <div className="flex flex-col items-start gap-3">
                  <div className="flex flex-wrap gap-2">
                    {member.roles.map((role) => (
                      <span
                        key={`${member.membershipId}-${role}`}
                        className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
                      >
                        {ROLE_LABELS[role] ?? role}
                      </span>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setSelectedMember({ membershipId: member.membershipId, name: member.name })}
                  >
                    Gestionar roles
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {selectedMember && (
        <RolesModal
          isOpen={true}
          tenantId={tenantId}
          membershipId={selectedMember.membershipId}
          memberName={selectedMember.name}
          buildings={buildings}
          onClose={() => setSelectedMember(null)}
        />
      )}
    </div>
  );
}
