'use client';

import { useState } from 'react';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import ErrorState from '@/shared/components/ui/ErrorState';
import EmptyState from '@/shared/components/ui/EmptyState';
import Skeleton from '@/shared/components/ui/Skeleton';
import { useToast } from '@/shared/components/ui/Toast';
import { useCommunicationsAdmin } from '../../hooks/useCommunicationsAdmin';
import { useAuth } from '@/features/auth/useAuth';
import { CommunicationComposerModal } from './CommunicationComposerModal';
import { CommunicationDetail } from './CommunicationDetail';
import { Bell, Plus } from 'lucide-react';
import type { Communication } from '../../services/communications.api';

interface CommunicationsListProps {
  buildingId: string;
  tenantId: string;
}

/**
 * CommunicationsList: Admin view for managing communications
 */
export function CommunicationsList({ buildingId, tenantId }: CommunicationsListProps) {
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<'all' | 'DRAFT' | 'SENT'>('all');
  const [showComposer, setShowComposer] = useState(false);
  const [selectedComm, setSelectedComm] = useState<Communication | null>(null);

  const {
    communications,
    loading,
    error,
    create,
    update,
    send,
    remove,
    refetch,
  } = useCommunicationsAdmin({ buildingId, tenantId });

  const isAdmin = currentUser?.roles?.some((r) => ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'].includes(r)) ?? false;

  // Filter communications by status
  const filtered = communications.filter((c) => {
    if (statusFilter === 'all') return true;
    return c.status === statusFilter;
  });

  const handleCreateOrUpdate = async (input: any, commId?: string) => {
    try {
      if (commId) {
        await update(commId, input);
        toast('Communication updated', 'success');
      } else {
        await create(input);
        toast('Communication created', 'success');
      }
      setShowComposer(false);
      setSelectedComm(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save communication';
      toast(message, 'error');
    }
  };

  const handleSend = async (commId: string) => {
    try {
      await send(commId);
      toast('Communication published', 'success');
      setSelectedComm(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to publish communication';
      toast(message, 'error');
    }
  };

  const handleDelete = async (commId: string) => {
    try {
      await remove(commId);
      toast('Communication deleted', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete communication';
      toast(message, 'error');
    }
  };

  if (error && filtered.length === 0) {
    return <ErrorState message={error} onRetry={refetch} />;
  }

  if (loading && filtered.length === 0) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} width="100%" height="120px" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Comunicados</h2>
        {isAdmin && (
          <Button onClick={() => setShowComposer(true)} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            Nuevo Comunicado
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {['all', 'DRAFT', 'SENT'].map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status as any)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition ${
              statusFilter === status
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {status === 'all' ? 'All' : status}
          </button>
        ))}
      </div>

      {/* Empty State */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Bell className="w-12 h-12 text-muted-foreground" />}
          title="No Communications"
          description="No communications found for the selected filter."
          cta={
            isAdmin
              ? {
                  text: 'Create First Communication',
                  onClick: () => setShowComposer(true),
                }
              : undefined
          }
        />
      ) : (
        /* Communications List */
        <div className="space-y-3">
          {filtered.map((comm) => (
            <Card
              key={comm.id}
              className="p-4 cursor-pointer hover:bg-muted/50 transition"
            >
              <div
                onClick={() => comm.status === 'DRAFT' ? undefined : setSelectedComm(comm)}
                className={comm.status === 'DRAFT' ? '' : 'cursor-pointer'}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-lg truncate">{comm.title}</h3>
                      <span
                        className={`text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ${
                          comm.status === 'DRAFT'
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {comm.status}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {comm.body}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span>{comm.channel}</span>
                      <span>
                        {comm.sentAt
                          ? `Sent ${new Date(comm.sentAt).toLocaleDateString()}`
                          : comm.scheduledAt
                          ? `Scheduled ${new Date(comm.scheduledAt).toLocaleDateString()}`
                          : 'Draft'}
                      </span>
                      {comm.receipts?.length > 0 && (
                        <span>
                          {comm.receipts.filter((r) => r.readAt).length}/{comm.receipts.length} read
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Draft Actions */}
                  {comm.status === 'DRAFT' && isAdmin && (
                    <div className="flex gap-2 ml-4">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedComm(comm);
                        }}
                      >
                        Edit
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Composer Modal */}
      {showComposer && (
        <CommunicationComposerModal
          buildingId={buildingId}
          tenantId={tenantId}
          onSave={handleCreateOrUpdate}
          onClose={() => setShowComposer(false)}
        />
      )}

      {/* Detail Modal (for sent communications or draft editing) */}
      {selectedComm && (
        <CommunicationDetail
          communication={selectedComm}
          isAdmin={isAdmin}
          onSave={(input) => handleCreateOrUpdate(input, selectedComm.id)}
          onSend={() => handleSend(selectedComm.id)}
          onDelete={async () => {
            await handleDelete(selectedComm.id);
            setSelectedComm(null);
          }}
          onClose={() => setSelectedComm(null)}
        />
      )}
    </div>
  );
}
