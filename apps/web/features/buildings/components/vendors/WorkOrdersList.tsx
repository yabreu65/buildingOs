'use client';

import { useState } from 'react';
import { useWorkOrders } from '../../hooks/useWorkOrders';
import { useVendors } from '../../hooks/useVendors';
import { useAuth } from '@/features/auth';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import EmptyState from '@/shared/components/ui/EmptyState';
import ErrorState from '@/shared/components/ui/ErrorState';
import Skeleton from '@/shared/components/ui/Skeleton';
import { useToast } from '@/shared/components/ui/Toast';
import DeleteConfirmDialog from '@/shared/components/ui/DeleteConfirmDialog';
import { Wrench, Plus } from 'lucide-react';
import WorkOrderCreateModal from './WorkOrderCreateModal';
import type { WorkOrder } from '../../services/vendors.api';

interface WorkOrdersListProps {
  buildingId: string;
}

const STATUS_COLORS = {
  OPEN: 'bg-blue-100 text-blue-800',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-800',
  DONE: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
};

const STATUS_LABELS = {
  OPEN: 'Abierto',
  IN_PROGRESS: 'En Progreso',
  DONE: 'Completado',
  CANCELLED: 'Cancelado',
};

export default function WorkOrdersList({ buildingId }: WorkOrdersListProps) {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedForCancel, setSelectedForCancel] = useState<string | null>(null);

  const { allVendors } = useVendors({ buildingId });
  const { workOrders, loading, error, updateStatus, refetch } = useWorkOrders({
    buildingId,
    filters: statusFilter ? { status: statusFilter } : undefined,
  });

  const isAdmin =
    currentUser?.roles?.some((r) => ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'].includes(r)) ?? false;

  const handleCreateSuccess = async () => {
    setShowCreateModal(false);
    toast('Work order created successfully', 'success');
    await refetch();
  };

  const handleStatusChange = async (workOrder: WorkOrder, newStatus: string) => {
    try {
      await updateStatus(workOrder.id, newStatus);
      toast(`Work order status updated to ${newStatus}`, 'success');
    } catch {
      toast('Failed to update work order status', 'error');
    }
  };

  const handleCancelConfirm = async (workOrderId: string) => {
    try {
      await updateStatus(workOrderId, 'CANCELLED');
      toast('Work order cancelled', 'success');
      setSelectedForCancel(null);
    } catch {
      toast('Failed to cancel work order', 'error');
    }
  };

  const getStatusActions = (workOrder: WorkOrder) => {
    switch (workOrder.status) {
      case 'OPEN':
        return [
          { label: 'Iniciar', status: 'IN_PROGRESS' },
          { label: 'Cancelar', status: 'CANCEL' },
        ];
      case 'IN_PROGRESS':
        return [
          { label: 'Completar', status: 'DONE' },
          { label: 'Cancelar', status: 'CANCEL' },
        ];
      default:
        return [];
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Órdenes de Trabajo</h2>
        {isAdmin && (
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Nueva Orden
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Todos los estados</option>
          <option value="OPEN">Abierto</option>
          <option value="IN_PROGRESS">En Progreso</option>
          <option value="DONE">Completado</option>
          <option value="CANCELLED">Cancelado</option>
        </select>
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
      {!loading && !error && workOrders.length === 0 && (
        <EmptyState
          icon={<Wrench className="w-12 h-12 text-muted-foreground" />}
          title="No Órdenes de Trabajo"
          description="No hay órdenes de trabajo en este edificio"
          cta={
            isAdmin
              ? {
                  text: 'Nueva Orden',
                  onClick: () => setShowCreateModal(true),
                }
              : undefined
          }
        />
      )}

      {/* List */}
      {!loading && !error && workOrders.length > 0 && (
        <div className="space-y-3">
          {workOrders.map((workOrder) => {
            const actions = getStatusActions(workOrder);
            return (
              <Card key={workOrder.id} className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    {workOrder.ticket && <h3 className="font-semibold">{workOrder.ticket.title}</h3>}
                    <p className="text-sm text-gray-600 mt-1">
                      {workOrder.vendor?.name || workOrder.assignedTo?.user?.name || 'Sin asignar'}
                    </p>
                    {workOrder.scheduledFor && (
                      <p className="text-sm text-gray-500 mt-1">
                        Programado: {new Date(workOrder.scheduledFor).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <span className={`px-2 py-1 rounded text-sm font-medium ${STATUS_COLORS[workOrder.status]}`}>
                    {STATUS_LABELS[workOrder.status]}
                  </span>
                </div>

                {workOrder.description && (
                  <p className="text-sm text-gray-600 mb-3 pb-3 border-b">{workOrder.description}</p>
                )}

                {actions.length > 0 && (
                  <div className="flex gap-2 pt-2">
                    {actions.map((action) => (
                      <Button
                        key={action.status}
                        size="sm"
                        variant={action.status === 'CANCEL' ? 'secondary' : undefined}
                        onClick={() => {
                          if (action.status === 'CANCEL') {
                            setSelectedForCancel(workOrder.id);
                          } else {
                            handleStatusChange(workOrder, action.status);
                          }
                        }}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <WorkOrderCreateModal
          buildingId={buildingId}
          vendors={allVendors}
          onSave={handleCreateSuccess}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {/* Cancel Confirmation */}
      <DeleteConfirmDialog
        isOpen={!!selectedForCancel}
        title="Cancel Work Order"
        description="Are you sure you want to cancel this work order?"
        onConfirm={() => handleCancelConfirm(selectedForCancel || '')}
        onCancel={() => setSelectedForCancel(null)}
      />
    </div>
  );
}
