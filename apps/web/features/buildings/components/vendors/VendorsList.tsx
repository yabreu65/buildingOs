'use client';

import { useState } from 'react';
import { useVendors } from '../../hooks/useVendors';
import { useAuth } from '@/features/auth';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import EmptyState from '@/shared/components/ui/EmptyState';
import ErrorState from '@/shared/components/ui/ErrorState';
import Skeleton from '@/shared/components/ui/Skeleton';
import { useToast } from '@/shared/components/ui/Toast';
import DeleteConfirmDialog from '@/shared/components/ui/DeleteConfirmDialog';
import { Users, Plus, Trash2, Phone, Mail } from 'lucide-react';
import VendorCreateModal from './VendorCreateModal';
import VendorAssignModal from './VendorAssignModal';

interface VendorsListProps {
  buildingId: string;
}

export default function VendorsList({ buildingId }: VendorsListProps) {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState<string | null>(null);

  const { assignments, allVendors, loading, error, createAndAssign, assignVendor, removeAssignment, refetch } =
    useVendors({ buildingId });

  const isAdmin =
    currentUser?.roles?.some((r) => ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'].includes(r)) ?? false;

  const handleCreateSuccess = async () => {
    setShowCreateModal(false);
    toast('Vendor created and assigned successfully', 'success');
    await refetch();
  };

  const handleAssignSuccess = async () => {
    setShowAssignModal(false);
    toast('Vendor assigned successfully', 'success');
    await refetch();
  };

  const handleRemoveConfirm = async (assignmentId: string) => {
    try {
      await removeAssignment(assignmentId);
      toast('Vendor removed', 'success');
      setSelectedForDelete(null);
    } catch {
      toast('Failed to remove vendor', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Proveedores</h2>
        {isAdmin && (
          <div className="flex gap-2">
            <Button onClick={() => setShowAssignModal(true)} variant="secondary">
              <Plus className="w-4 h-4 mr-2" />
              Asignar Proveedor
            </Button>
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Crear Proveedor
            </Button>
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && <ErrorState message={error} onRetry={refetch} />}

      {/* Empty */}
      {!loading && !error && assignments.length === 0 && (
        <EmptyState
          icon={<Users className="w-12 h-12 text-muted-foreground" />}
          title="No Proveedores Asignados"
          description="Asigna un proveedor para comenzar"
          cta={
            isAdmin
              ? {
                  text: 'Asignar Proveedor',
                  onClick: () => setShowAssignModal(true),
                }
              : undefined
          }
        />
      )}

      {/* List */}
      {!loading && !error && assignments.length > 0 && (
        <div className="space-y-3">
          {assignments.map((assignment) => (
            <Card key={assignment.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">{assignment.vendor?.name}</h3>
                  <p className="text-sm text-gray-600 mt-1">{assignment.serviceType}</p>
                  <div className="flex gap-4 mt-3 text-sm text-gray-600">
                    {assignment.vendor?.email && (
                      <a
                        href={`mailto:${assignment.vendor.email}`}
                        className="flex items-center gap-1 hover:text-primary"
                      >
                        <Mail className="w-4 h-4" />
                        {assignment.vendor.email}
                      </a>
                    )}
                    {assignment.vendor?.phone && (
                      <a
                        href={`tel:${assignment.vendor.phone}`}
                        className="flex items-center gap-1 hover:text-primary"
                      >
                        <Phone className="w-4 h-4" />
                        {assignment.vendor.phone}
                      </a>
                    )}
                  </div>
                </div>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedForDelete(assignment.id)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Modals */}
      {showCreateModal && (
        <VendorCreateModal buildingId={buildingId} onSave={handleCreateSuccess} onClose={() => setShowCreateModal(false)} />
      )}

      {showAssignModal && (
        <VendorAssignModal
          allVendors={allVendors}
          onSave={handleAssignSuccess}
          onClose={() => setShowAssignModal(false)}
          assignVendor={assignVendor}
        />
      )}

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        isOpen={!!selectedForDelete}
        title="Remove Vendor"
        description="Are you sure you want to remove this vendor assignment?"
        onConfirm={() => handleRemoveConfirm(selectedForDelete || '')}
        onCancel={() => setSelectedForDelete(null)}
      />
    </div>
  );
}
