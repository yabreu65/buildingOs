'use client';

import { useState } from 'react';
import { t } from '@/i18n';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import ErrorState from '@/shared/components/ui/ErrorState';
import EmptyState from '@/shared/components/ui/EmptyState';
import Skeleton from '@/shared/components/ui/Skeleton';
import { useToast } from '@/shared/components/ui/Toast';
import { useCommunicationsAdmin } from '../hooks/useCommunicationsAdmin';
import { useAuth } from '@/features/auth/useAuth';
import { CommunicationComposerModal } from './CommunicationComposerModal';
import { CommunicationDetail } from './CommunicationDetail';
import { Bell, Plus, Search, Send, FileEdit, Clock, TrendingUp } from 'lucide-react';
import type { Communication, CommunicationStatus, CommunicationChannel } from '../services/communications.api';
import type { CommunicationInput } from '@/types/communication';
import { ADMIN_ROLES } from '@buildingos/contracts';
import { StatusBadge } from './StatusBadge';

interface CommunicationsListProps {
  buildingId: string;
  tenantId: string;
}

interface KpiCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}

interface StatusOption {
  value: 'all' | CommunicationStatus;
  label: string;
}

interface ChannelOption {
  value: 'all' | CommunicationChannel;
  label: string;
}

const KpiCard = ({ label, value, icon }: KpiCardProps) => {
  return (
    <div className="flex flex-col gap-1 p-4 bg-muted rounded-lg">
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        {icon}
        <span>{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
};

/**
 * CommunicationsList: Admin view for managing communications
 */
export const CommunicationsList = ({ buildingId, tenantId }: CommunicationsListProps) => {
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const [showComposer, setShowComposer] = useState(false);
  const [selectedComm, setSelectedComm] = useState<Communication | null>(null);
  const [localSearch, setLocalSearch] = useState('');

  const {
    communications,
    loading,
    error,
    filters,
    setFilters,
    metrics,
    create,
    update,
    send,
    remove,
    refetch,
  } = useCommunicationsAdmin({ buildingId, tenantId });

  const isAdmin = currentUser?.roles?.some((r) => ADMIN_ROLES.includes(r as typeof ADMIN_ROLES[number])) ?? false;

  const statusOptions: StatusOption[] = [
    { value: 'all', label: t('communications.admin.filterAll') },
    { value: 'DRAFT', label: t('communications.admin.filterDraft') },
    { value: 'SCHEDULED', label: t('communications.admin.filterScheduled') },
    { value: 'SENT', label: t('communications.admin.filterSent') },
  ];

  const channelOptions: ChannelOption[] = [
    { value: 'all', label: t('communications.admin.filterAll') },
    { value: 'IN_APP', label: t('communications.admin.channelInApp') },
    { value: 'WHATSAPP', label: t('communications.admin.channelWhatsapp') + ' (Próximamente)' },
  ];

  const handleSearchSubmit = () => {
    setFilters((prev) => ({ ...prev, search: localSearch }));
  };

  const handleCreateOrUpdate = async (input: CommunicationInput, commId?: string) => {
    try {
      if (commId) {
        await update(commId, input);
        toast(t('communications.admin.updatedSuccess'), 'success');
      } else {
        await create(input);
        toast(t('communications.admin.createdSuccess'), 'success');
      }
      setShowComposer(false);
      setSelectedComm(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('communications.error');
      toast(message, 'error');
    }
  };

  const handleSend = async (commId: string, scheduledAt?: Date) => {
    try {
      await send(commId, scheduledAt);
      if (scheduledAt) {
        toast(t('communications.admin.scheduledSuccess'), 'success');
      } else {
        toast(t('communications.admin.publishedSuccess'), 'success');
      }
      setSelectedComm(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('communications.error');
      toast(message, 'error');
    }
  };

  const handleDelete = async (commId: string) => {
    try {
      await remove(commId);
      toast(t('communications.admin.deletedSuccess'), 'success');
      setSelectedComm(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('communications.error');
      toast(message, 'error');
    }
  };

  if (error && communications.length === 0) {
    return <ErrorState message={error} onRetry={refetch} />;
  }

  if (loading && communications.length === 0) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} width="100%" height="80px" />)}
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} width="100%" height="96px" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t('communications.admin.pageTitle')}</h2>
        {isAdmin && (
          <Button onClick={() => setShowComposer(true)} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            {t('communications.admin.newButton')}
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label={t('communications.admin.kpiSent')}
          value={metrics.sent}
          icon={<Send className="w-3 h-3" />}
        />
        <KpiCard
          label={t('communications.admin.kpiDrafts')}
          value={metrics.drafts}
          icon={<FileEdit className="w-3 h-3" />}
        />
        <KpiCard
          label={t('communications.admin.kpiScheduled')}
          value={metrics.scheduled}
          icon={<Clock className="w-3 h-3" />}
        />
        <KpiCard
          label={t('communications.admin.kpiReadRate')}
          value={`${metrics.readRate}%`}
          icon={<TrendingUp className="w-3 h-3" />}
        />
      </div>

      {/* Search + Filters */}
      <div className="space-y-2">
        {/* Search bar */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearchSubmit()}
              placeholder={t('communications.admin.searchPlaceholder')}
              className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm"
            />
          </div>
          <Button variant="secondary" size="sm" onClick={handleSearchSubmit}>
            <Search className="w-4 h-4" />
          </Button>
        </div>

        {/* Status + Channel chips */}
        <div className="flex flex-wrap gap-2">
          {statusOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilters((prev) => ({ ...prev, status: opt.value }))}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                filters.status === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <div className="h-5 w-px bg-border self-center mx-1" />
          {channelOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilters((prev) => ({ ...prev, channel: opt.value }))}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                filters.channel === opt.value
                  ? 'bg-secondary text-secondary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {opt.label}
            </button>
          ))}
          {/* Sort toggle */}
          <button
            onClick={() => setFilters((prev) => ({ ...prev, sortOrder: prev.sortOrder === 'desc' ? 'asc' : 'desc' }))}
            className="ml-auto px-3 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition"
          >
            {filters.sortOrder === 'desc' ? t('communications.admin.sortNewest') : t('communications.admin.sortOldest')}
          </button>
        </div>
      </div>

      {/* Empty State */}
      {communications.length === 0 ? (
        <EmptyState
          icon={<Bell className="w-12 h-12 text-muted-foreground" />}
          title={t('communications.admin.emptyTitle')}
          description={t('communications.admin.emptyDesc')}
          cta={
            isAdmin
              ? {
                  text: t('communications.admin.createFirst'),
                  onClick: () => setShowComposer(true),
                }
              : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {communications.map((comm) => (
            <Card
              key={comm.id}
              className="p-4 cursor-pointer hover:bg-muted/50 transition"
              onClick={() => setSelectedComm(comm)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-base truncate">{comm.title}</h3>
                    <StatusBadge status={comm.status} />
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                    {comm.body}
                  </p>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="font-medium">{
                      comm.channel === 'WHATSAPP' ? t('communications.admin.channelWhatsapp') :
                      comm.channel === 'PUSH' ? t('communications.admin.channelPush') :
                      t('communications.admin.channelInApp')
                    }</span>
                    {comm.sentAt && (
                      <span>{t('communications.admin.sentAtLabel')} {new Date(comm.sentAt).toLocaleDateString('es-AR')}</span>
                    )}
                    {comm.scheduledAt && comm.status === 'SCHEDULED' && (
                      <span>{t('communications.admin.scheduledAtLabel')} {new Date(comm.scheduledAt).toLocaleDateString('es-AR')}</span>
                    )}
                    {!comm.sentAt && !comm.scheduledAt && (
                      <span>{new Date(comm.createdAt).toLocaleDateString('es-AR')}</span>
                    )}
                    {comm.receipts?.length > 0 && (
                      <span>
                        {comm.receipts.filter((r) => r.readAt).length}/{comm.receipts.length} {t('communications.admin.readCount')}
                      </span>
                    )}
                  </div>
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
          onSave={handleCreateOrUpdate}
          onClose={() => setShowComposer(false)}
        />
      )}

      {/* Detail Modal */}
      {selectedComm && (
        <CommunicationDetail
          communication={selectedComm}
          isAdmin={isAdmin}
          onSave={(input) => handleCreateOrUpdate(input, selectedComm.id)}
          onSend={(scheduledAt) => handleSend(selectedComm.id, scheduledAt)}
          onDelete={async () => handleDelete(selectedComm.id)}
          onClose={() => setSelectedComm(null)}
        />
      )}
    </div>
  );
};
