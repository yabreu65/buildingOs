'use client';

import { useState } from 'react';
import Button from '@/shared/components/ui/Button';
import { useToast } from '@/shared/components/ui/Toast';
import { Plus } from 'lucide-react';
import { Charge, ChargeType } from '../services/finance.api';
import { useCreateCharge } from '../hooks/useCharges';
import { ChargesTable } from './ChargesTable';
import { ChargeCreateModal } from './ChargeCreateModal';

interface ChargesTabProps {
  buildingId: string;
  charges: Charge[];
  loading: boolean;
  error: string | null;
  onChargeCreated: () => Promise<void>;
  onRefresh?: () => Promise<void>;
}

/**
 * ChargesTab: Tab for managing charges with create modal
 */
export function ChargesTab({
  buildingId,
  charges,
  loading,
  error,
  onChargeCreated,
  onRefresh,
}: ChargesTabProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const createMutation = useCreateCharge(buildingId);

  const handleCreateCharge = async (data: {
    unitId: string;
    concept: string;
    type: ChargeType;
    amount: number;
    dueDate: string;
  }) => {
    await createMutation.mutateAsync(data);
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">Cargos</h3>
          <Button
            onClick={() => setShowCreateModal(true)}
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            Crear cargo
          </Button>
        </div>

        <ChargesTable
          charges={charges}
          loading={loading}
          error={error}
          onRefresh={onRefresh}
          buildingId={buildingId}
        />
      </div>

      {showCreateModal && (
        <ChargeCreateModal
          buildingId={buildingId}
          onClose={() => setShowCreateModal(false)}
          onSave={onChargeCreated}
          onCreate={handleCreateCharge}
        />
      )}
    </>
  );
}
