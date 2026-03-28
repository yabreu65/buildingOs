'use client';

import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import { apiClient } from '@/shared/lib/http/client';
import { useAssignableResidents, CreateMemberModal } from '@/features/tenant-members';
import { useToast } from '@/shared/components/ui/Toast';
import { t } from '@/i18n';

interface AssignResidentModalProps {
  tenantId: string;
  buildingId: string;
  unitId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const AssignResidentModal = ({
  tenantId,
  buildingId,
  unitId,
  onClose,
  onSuccess,
}: AssignResidentModalProps) => {
  const { toast } = useToast();
  const { data: residents = [], isLoading } = useAssignableResidents(tenantId, unitId);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [role, setRole] = useState<'OWNER' | 'RESIDENT'>('RESIDENT');
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [showCreateMember, setShowCreateMember] = useState(false);

  const handleAssign = async () => {
    if (!selectedMemberId) {
      setError(t('units.selectResident'));
      return;
    }

    setAssigning(true);
    setError(null);

    try {
      await apiClient({
        path: `/tenants/${tenantId}/buildings/${buildingId}/units/${unitId}/occupants`,
        method: 'POST',
        body: {
          memberId: selectedMemberId,
          role,
        },
      });

      toast(t('units.residentAssigned'), 'success');
      onSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('units.assignError');
      setError(message);
      toast(message, 'error');
    } finally {
      setAssigning(false);
    }
  };

  const handleMemberCreated = () => {
    setShowCreateMember(false);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <Card className="max-w-lg w-full border-blue-200 bg-blue-50">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Asignar Residente</h2>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
              disabled={assigning}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded text-red-700 text-sm">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground">Cargando residentes...</div>
          ) : residents.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-muted-foreground mb-4">No hay residentes disponibles</p>
              <Button
                onClick={() => setShowCreateMember(true)}
                className="flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Crear Nuevo Residente
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Selecciona un Residente</label>
                  <select
                    value={selectedMemberId}
                    onChange={(e) => setSelectedMemberId(e.target.value)}
                    disabled={assigning}
                    className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- Selecciona --</option>
                    {residents.map((resident) => (
                      <option key={resident.id} value={resident.id}>
                        {resident.name}
                        {resident.email && ` (${resident.email})`}
                        {resident.status === 'DRAFT' && ' - BORRADOR'}
                        {resident.status === 'PENDING_INVITE' && ' - INVITACIÓN PENDIENTE'}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Rol en la Unidad</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as 'OWNER' | 'RESIDENT')}
                    disabled={assigning}
                    className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="RESIDENT">Residente</option>
                    <option value="OWNER">Propietario</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-2 mt-6 pt-4 border-t">
                <Button
                  onClick={onClose}
                  variant="secondary"
                  disabled={assigning}
                  className="flex-1"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleAssign}
                  disabled={!selectedMemberId || assigning}
                  className="flex-1 flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  {assigning ? 'Asignando...' : 'Asignar'}
                </Button>
              </div>

              <div className="mt-4 pt-4 border-t">
                <button
                  onClick={() => setShowCreateMember(true)}
                  disabled={assigning}
                  className="w-full text-center text-sm text-blue-600 hover:text-blue-700 hover:underline disabled:text-gray-400"
                >
                  + Crear Nuevo Residente
                </button>
              </div>
            </>
          )}
        </Card>
      </div>

      {showCreateMember && (
        <CreateMemberModal
          tenantId={tenantId}
          onClose={() => setShowCreateMember(false)}
          onSuccess={handleMemberCreated}
        />
      )}
    </>
  );
}
