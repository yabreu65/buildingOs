'use client';

import { useState } from 'react';
import { useQuotes } from '../../hooks/useQuotes';
import { useVendors } from '../../hooks/useVendors';
import { useAuth } from '@/features/auth';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import EmptyState from '@/shared/components/ui/EmptyState';
import ErrorState from '@/shared/components/ui/ErrorState';
import Skeleton from '@/shared/components/ui/Skeleton';
import { useToast } from '@/shared/components/ui/Toast';
import { FileText, Plus } from 'lucide-react';
import QuoteCreateModal from './QuoteCreateModal';
import type { Quote } from '../../services/vendors.api';

interface QuotesListProps {
  buildingId: string;
}

const STATUS_COLORS = {
  REQUESTED: 'bg-blue-100 text-blue-800',
  RECEIVED: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
};

const STATUS_LABELS = {
  REQUESTED: 'Solicitado',
  RECEIVED: 'Recibido',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
};

export default function QuotesList({ buildingId }: QuotesListProps) {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');

  const { allVendors } = useVendors({ buildingId });
  const { quotes, loading, error, updateStatus, refetch } = useQuotes({
    buildingId,
    filters: statusFilter ? { status: statusFilter } : undefined,
  });

  const isAdmin =
    currentUser?.roles?.some((r) => ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'].includes(r)) ?? false;
  const canApprove =
    currentUser?.roles?.some((r) => ['TENANT_ADMIN', 'TENANT_OWNER'].includes(r)) ?? false;

  const handleCreateSuccess = async () => {
    setShowCreateModal(false);
    toast('Quote created successfully', 'success');
    await refetch();
  };

  const handleStatusChange = async (quote: Quote, newStatus: string) => {
    try {
      await updateStatus(quote.id, newStatus);
      toast(`Quote status updated to ${newStatus}`, 'success');
    } catch {
      toast('Failed to update quote status', 'error');
    }
  };

  const getStatusActions = (quote: Quote) => {
    switch (quote.status) {
      case 'REQUESTED':
        return isAdmin ? [{ label: 'Marcar Recibido', status: 'RECEIVED' }] : [];
      case 'RECEIVED':
        return canApprove
          ? [
              { label: 'Aprobar', status: 'APPROVED' },
              { label: 'Rechazar', status: 'REJECTED' },
            ]
          : [];
      default:
        return [];
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Presupuestos</h2>
        {isAdmin && (
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Nueva Cotización
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
          <option value="REQUESTED">Solicitado</option>
          <option value="RECEIVED">Recibido</option>
          <option value="APPROVED">Aprobado</option>
          <option value="REJECTED">Rechazado</option>
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && <ErrorState message={error} onRetry={refetch} />}

      {/* Empty */}
      {!loading && !error && quotes.length === 0 && (
        <EmptyState
          icon={<FileText className="w-12 h-12 text-muted-foreground" />}
          title="No Presupuestos"
          description="No hay presupuestos en este edificio"
          cta={
            isAdmin
              ? {
                  text: 'Nueva Cotización',
                  onClick: () => setShowCreateModal(true),
                }
              : undefined
          }
        />
      )}

      {/* List */}
      {!loading && !error && quotes.length > 0 && (
        <div className="space-y-3">
          {quotes.map((quote) => {
            const actions = getStatusActions(quote);
            return (
              <Card key={quote.id} className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="font-semibold">{quote.vendor?.name}</h3>
                    {quote.ticket && (
                      <p className="text-sm text-gray-600">{quote.ticket.title}</p>
                    )}
                  </div>
                  <span className={`px-2 py-1 rounded text-sm font-medium ${STATUS_COLORS[quote.status]}`}>
                    {STATUS_LABELS[quote.status]}
                  </span>
                </div>

                <div className="mb-3 text-sm text-gray-600">
                  <p className="font-medium">
                    {quote.currency} ${quote.amount.toFixed(2)}
                  </p>
                  {quote.notes && <p className="mt-1">{quote.notes}</p>}
                </div>

                {actions.length > 0 && (
                  <div className="flex gap-2 pt-2 border-t">
                    {actions.map((action) => (
                      <Button
                        key={action.status}
                        size="sm"
                        variant="secondary"
                        onClick={() => handleStatusChange(quote, action.status)}
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
        <QuoteCreateModal
          buildingId={buildingId}
          vendors={allVendors}
          onSave={handleCreateSuccess}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}
