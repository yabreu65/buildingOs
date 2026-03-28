'use client';

import { useState, useMemo, useCallback } from 'react';
import { useTickets } from '../hooks/useTickets';
import { useUnits } from '@/features/buildings/hooks/useUnits';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import EmptyState from '@/shared/components/ui/EmptyState';
import ErrorState from '@/shared/components/ui/ErrorState';
import Skeleton from '@/shared/components/ui/Skeleton';
import { useToast } from '@/shared/components/ui/Toast';
import { Ticket as TicketIcon, Plus, Filter, AlertCircle, Clock, CheckCircle, XCircle } from 'lucide-react';
import TicketForm from './TicketForm';
import { t } from '@/i18n';
import TicketDetail from './TicketDetail';
import type { Ticket } from '../services/tickets.api';
import type { TicketStatus } from '@/types/enums';

interface TicketsListProps {
  buildingId: string;
  tenantId: string;
}

type StatusFilterValue = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'all_open' | '';

/**
 * Renderiza el listado de tickets del edificio con filtros y KPIs.
 */
export function TicketsList({ buildingId, tenantId }: TicketsListProps) {
  const { toast } = useToast();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all_open');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [unitIdFilter, setUnitIdFilter] = useState<string>('');

  const { units } = useUnits(tenantId, buildingId);

  const filters = useMemo(() => ({
    status: statusFilter === 'all_open' ? undefined : statusFilter || undefined,
    priority: priorityFilter || undefined,
    unitId: unitIdFilter || undefined,
  }), [statusFilter, priorityFilter, unitIdFilter]);

  const { tickets, loading, error, create, update, addComment, refetch } = useTickets({
    buildingId,
    filters,
  });

  const statusCounts = useMemo(() => {
    return {
      open: tickets.filter((t) => t.status === 'OPEN').length,
      inProgress: tickets.filter((t) => t.status === 'IN_PROGRESS').length,
      resolved: tickets.filter((t) => t.status === 'RESOLVED').length,
      closed: tickets.filter((t) => t.status === 'CLOSED').length,
    };
  }, [tickets]);

  const visibleTickets = useMemo(() => {
    if (statusFilter === 'all_open') {
      return tickets.filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS');
    }
    return tickets;
  }, [tickets, statusFilter]);

  const handleCreateSuccess = useCallback(async (ticket: Ticket) => {
    setShowCreateForm(false);
    toast(t('tickets.created'), 'success');
    await refetch();
  }, [toast, refetch]);

  const handleStatusChange = useCallback(async (ticketId: string, newStatus: string) => {
    try {
      await update(ticketId, { status: newStatus as TicketStatus });
      toast(t('tickets.statusUpdated') || 'Estado actualizado', 'success');
      setSelectedTicket(null);
      await refetch();
    } catch {
      toast(t('tickets.errors.statusUpdateFailed') || 'Error al actualizar estado', 'error');
    }
  }, [update, refetch, toast]);

  const handleAddComment = useCallback(async (ticketId: string, body: string) => {
    try {
      await addComment(ticketId, { body });
      toast(t('tickets.commentAdded'), 'success');
      const updated = tickets.find((tk) => tk.id === ticketId);
      if (updated) {
        setSelectedTicket(updated);
      }
    } catch {
      toast(t('tickets.errors.commentFailed'), 'error');
    }
  }, [addComment, tickets, toast]);

  const handleTicketClick = useCallback((ticket: Ticket) => {
    setSelectedTicket(ticket);
  }, []);

  const getStatusBadge = (status: string) => {
    const config: Record<string, { label: string; className: string }> = {
      OPEN: { label: 'Abierta', className: 'bg-blue-100 text-blue-800' },
      IN_PROGRESS: { label: 'En progreso', className: 'bg-yellow-100 text-yellow-800' },
      RESOLVED: { label: 'Resuelta', className: 'bg-green-100 text-green-800' },
      CLOSED: { label: 'Cerrada', className: 'bg-gray-100 text-gray-600' },
    };
    const c = config[status] || { label: status, className: 'bg-gray-100 text-gray-600' };
    return <span className={`text-xs font-medium px-2 py-1 rounded ${c.className}`}>{c.label}</span>;
  };

  const getPriorityBadge = (priority: string) => {
    const config: Record<string, { label: string; className: string }> = {
      LOW: { label: 'Baja', className: 'bg-green-50 text-green-700 border border-green-200' },
      MEDIUM: { label: 'Media', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
      HIGH: { label: 'Alta', className: 'bg-orange-50 text-orange-700 border border-orange-200' },
      URGENT: { label: 'Urgente', className: 'bg-red-50 text-red-700 border border-red-200' },
    };
    const c = config[priority] || { label: priority, className: 'bg-gray-50 text-gray-700 border border-gray-200' };
    return <span className={`text-xs font-medium px-2 py-1 rounded ${c.className}`}>{c.label}</span>;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return 'Hoy';
    } else if (diffDays === 1) {
      return 'Ayer';
    } else if (diffDays < 7) {
      return `Hace ${diffDays} días`;
    } else {
      return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
    }
  };

  const getCategoryLabel = (category: string) => {
    const config: Record<string, string> = {
      MAINTENANCE: 'Mantenimiento',
      REPAIR: 'Reparación',
      CLEANING: 'Limpieza',
      COMPLAINT: 'Reclamo',
      OTHER: 'Otro',
    };
    return config[category] || category;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">{t('tickets.title')}</h2>
        <Button onClick={() => setShowCreateForm(true)}>
          <Plus className="w-4 h-4 mr-2" />
          {t('tickets.createTicket')}
        </Button>
      </div>

      {showCreateForm && (
        <Card className="border-blue-200 bg-blue-50">
          <div className="mb-4 flex justify-between items-center">
            <h3 className="text-lg font-semibold">{t('tickets.create')}</h3>
            <button
              onClick={() => setShowCreateForm(false)}
              className="text-gray-500 hover:text-gray-700"
            >
              ×
            </button>
          </div>
          <TicketForm
            buildingId={buildingId}
            units={units}
            onSuccess={handleCreateSuccess}
            onCancel={() => setShowCreateForm(false)}
          />
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <AlertCircle className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold">{statusCounts.open}</p>
            <p className="text-xs text-muted-foreground">Abiertas</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="p-2 bg-yellow-100 rounded-lg">
            <Clock className="w-5 h-5 text-yellow-600" />
          </div>
          <div>
            <p className="text-2xl font-bold">{statusCounts.inProgress}</p>
            <p className="text-xs text-muted-foreground">En progreso</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="p-2 bg-green-100 rounded-lg">
            <CheckCircle className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-bold">{statusCounts.resolved}</p>
            <p className="text-xs text-muted-foreground">Resueltas</p>
          </div>
        </Card>
        <Card className="p-4 flex items-center gap-3">
          <div className="p-2 bg-gray-100 rounded-lg">
            <XCircle className="w-5 h-5 text-gray-600" />
          </div>
          <div>
            <p className="text-2xl font-bold">{statusCounts.closed}</p>
            <p className="text-xs text-muted-foreground">Cerradas</p>
          </div>
        </Card>
      </div>

      <div className="flex gap-4 flex-wrap">
        <div>
          <label className="block text-sm font-medium mb-1">{t('tickets.status')}</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilterValue)}
            className="px-3 py-2 border rounded-md text-sm"
          >
            <option value="all_open">Abiertas + En proceso</option>
            <option value="OPEN">Abiertas</option>
            <option value="IN_PROGRESS">En progreso</option>
            <option value="RESOLVED">Resueltas</option>
            <option value="CLOSED">Cerradas</option>
            <option value="">Todos los estados</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">{t('tickets.priority')}</label>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-3 py-2 border rounded-md text-sm"
          >
            <option value="">{t('tickets.priorities.all') || 'Todas'}</option>
            <option value="LOW">{t('tickets.priorities.low')}</option>
            <option value="MEDIUM">{t('tickets.priorities.medium')}</option>
            <option value="HIGH">{t('tickets.priorities.high')}</option>
            <option value="URGENT">{t('tickets.priorities.urgent')}</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">{t('tickets.unit')}</label>
          <select
            value={unitIdFilter}
            onChange={(e) => setUnitIdFilter(e.target.value)}
            className="px-3 py-2 border rounded-md text-sm min-w-[150px]"
          >
            <option value="">Todas las unidades</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label || u.unitCode}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={refetch} />}

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height="100px" />
          ))}
        </div>
      )}

      {!loading && visibleTickets.length === 0 && (
        <EmptyState
          icon={<TicketIcon className="w-12 h-12 text-muted-foreground" />}
          title={t('tickets.noTickets')}
          description={t('tickets.emptyDescription')}
          cta={{
            text: t('tickets.createTicket'),
            onClick: () => setShowCreateForm(true),
          }}
        />
      )}

      {!loading && visibleTickets.length > 0 && (
        <div className="space-y-3">
          {visibleTickets.map((ticket) => (
            <Card
              key={ticket.id}
              className="cursor-pointer hover:shadow-md transition p-4"
              onClick={() => handleTicketClick(ticket)}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-muted-foreground font-mono">#{ticket.id.slice(-6)}</span>
                    {getPriorityBadge(ticket.priority)}
                  </div>
                  <h3 className="font-semibold text-foreground">{ticket.title}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                    {ticket.description}
                  </p>
                </div>
                {getStatusBadge(ticket.status)}
              </div>
              <div className="flex justify-between items-center text-xs text-muted-foreground mt-3 pt-2 border-t">
                <div className="flex items-center gap-3">
                  <span className="bg-muted px-2 py-0.5 rounded">
                    {getCategoryLabel(ticket.category)}
                  </span>
                  {ticket.unit && (
                    <span className="text-blue-600">
                      {ticket.unit.label}
                    </span>
                  )}
                  {ticket.assignedTo && (
                    <span className="text-muted-foreground">
                      → {ticket.assignedTo.user.name}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span>{formatDate(ticket.createdAt)}</span>
                  <span className="flex items-center gap-1">
                    💬 {ticket.comments?.length || 0}
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {selectedTicket && (
        <TicketDetail
          buildingId={buildingId}
          tenantId={tenantId}
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onStatusChange={handleStatusChange}
          onAddComment={handleAddComment}
        />
      )}
    </div>
  );
}
