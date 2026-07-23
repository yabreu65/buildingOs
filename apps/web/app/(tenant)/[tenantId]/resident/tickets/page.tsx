'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare,
  Plus,
  AlertCircle,
  Clock,
  CheckCircle,
  Loader2,
  Filter,
  ChevronRight,
} from 'lucide-react';
import { useResidentContext } from '../../../../../features/resident/hooks/useResidentContext';
import { getResidentTickets } from '../../../../../features/resident/api/resident-context.api';
import { createTicket, getTicket, addComment, type Ticket } from '../../../../../features/tickets/services/tickets.api';
import { ticketCategoryLabel } from '../../../../../features/tickets/ticket-labels';
import { useTenants } from '../../../../../features/tenants/tenants.hooks';
import { useAuthSession } from '../../../../../features/auth/useAuthSession';
import Card from '../../../../../shared/components/ui/Card';
import Skeleton from '../../../../../shared/components/ui/Skeleton';

function ticketStatusLabel(status: Ticket['status']): string {
  const labels: Record<Ticket['status'], string> = {
    OPEN: 'Abierto',
    IN_PROGRESS: 'En proceso',
    RESOLVED: 'Resuelto',
    CLOSED: 'Cerrado',
  };
  return labels[status] ?? status;
}

function priorityLabel(priority: Ticket['priority']): string {
  const labels: Record<Ticket['priority'], string> = {
    LOW: 'Baja',
    MEDIUM: 'Media',
    HIGH: 'Alta',
    URGENT: 'Urgente',
  };
  return labels[priority] ?? priority;
}

function priorityColor(priority: Ticket['priority']): string {
  const colors: Record<Ticket['priority'], string> = {
    LOW: 'bg-gray-100 text-gray-700',
    MEDIUM: 'bg-blue-100 text-blue-700',
    HIGH: 'bg-orange-100 text-orange-700',
    URGENT: 'bg-red-100 text-red-700',
  };
  return colors[priority] ?? 'bg-gray-100 text-gray-700';
}

function statusColor(status: Ticket['status']): string {
  const colors: Record<Ticket['status'], string> = {
    OPEN: 'text-orange-600',
    IN_PROGRESS: 'text-blue-600',
    RESOLVED: 'text-green-600',
    CLOSED: 'text-gray-600',
  };
  return colors[status] ?? 'text-gray-600';
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(dateStr));
}

export default function ResidentTicketsPage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId;
  const session = useAuthSession();
  const userId = session?.user.id ?? null;
  const queryClient = useQueryClient();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTicket, setNewTicket] = useState({
    title: '',
    description: '',
    category: 'OTHER',
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);

  const { data: tenants } = useTenants();
  const tenantName = tenants?.find((t) => t.id === tenantId)?.name ?? tenantId;

  const { data: context, isLoading: contextLoading } = useResidentContext(tenantId ?? null);
  const buildingId = context?.activeBuildingId;
  const unitId = context?.activeUnitId;
  const identityMatchesRoute = Boolean(
    userId && tenantId && session?.activeTenantId === tenantId && context?.tenantId === tenantId,
  );

  useEffect(() => {
    queueMicrotask(() => {
      setSelectedTicket(null);
      setShowCreateForm(false);
      setCommentBody('');
      setDetailError(null);
      setError(null);
      setSuccess(null);
    });
    void queryClient.removeQueries({ queryKey: ['residentTickets'] });
  }, [queryClient, userId, tenantId, buildingId, unitId]);

  const {
    data: tickets = [],
    isLoading,
    isError: ticketsError,
    error: ticketsErrorValue,
    refetch,
  } = useQuery<Ticket[]>({
    queryKey: ['residentTickets', userId, tenantId, buildingId, unitId],
    queryFn: () => getResidentTickets(buildingId!, unitId!, 50),
    enabled: identityMatchesRoute && !!buildingId && !!unitId && !contextLoading,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identityMatchesRoute || !buildingId || !unitId || contextLoading) return;

    const title = newTicket.title.trim();
    const description = newTicket.description.trim();
    if (!title || !description) {
      setError('Completá el título y la descripción antes de continuar.');
      return;
    }

    setCreating(true);
    setError(null);
    setSuccess(null);

    try {
      await createTicket(buildingId, {
        title,
        description,
        category: newTicket.category as Ticket['category'],
        unitId,
      });
      setSuccess('Reclamo creado correctamente');
      setNewTicket({
        title: '',
        description: '',
        category: 'OTHER',
      });
      setShowCreateForm(false);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos crear el reclamo. Intentá nuevamente.');
    } finally {
      setCreating(false);
    }
  };

  const statusFilter = 'all';
  const filteredTickets = statusFilter === 'all' 
    ? tickets 
    : tickets.filter(t => t.status === statusFilter);

  const openTicketDetail = async (ticketId: string) => {
    if (!identityMatchesRoute || !buildingId) return;
    setDetailLoading(true);
    setDetailError(null);
    try {
      setSelectedTicket(await getTicket(buildingId, ticketId));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'No pudimos cargar el reclamo.');
    } finally {
      setDetailLoading(false);
    }
  };

  const submitComment = async () => {
    if (!identityMatchesRoute || !selectedTicket || !buildingId || !commentBody.trim()) return;
    setCommentLoading(true);
    setDetailError(null);
    try {
      await addComment(buildingId, selectedTicket.id, { body: commentBody.trim() });
      setCommentBody('');
      setSelectedTicket(await getTicket(buildingId, selectedTicket.id));
      void queryClient.invalidateQueries({ queryKey: ['residentTickets'] });
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'No pudimos enviar el comentario.');
    } finally {
      setCommentLoading(false);
    }
  };

  if (contextLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  if (!identityMatchesRoute || !buildingId || !unitId) {
    return (
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <MessageSquare className="w-6 h-6" />
          Mis reclamos
        </h1>
        <p className="text-muted-foreground mt-1">{tenantName}</p>
        
        <Card className="p-4 mt-6 border-yellow-300 bg-yellow-50">
          <div className="flex items-center gap-2">
            <AlertCircle className="text-yellow-600" size={20} />
            <div>
              <p className="font-medium text-yellow-800">Sin unidad asignada</p>
              <p className="text-sm text-yellow-700">Comunicate con la administración para que te asignen una unidad.</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <MessageSquare className="w-6 h-6" />
            Mis reclamos
          </h1>
          <p className="text-muted-foreground mt-1">
            {tenantName}
            {buildingId && unitId && ' • Tu unidad'}
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          disabled={!identityMatchesRoute || contextLoading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          type="button"
        >
          <Plus className="w-4 h-4" />
          Crear reclamo
        </button>
      </div>

      {showCreateForm && (
        <Card className="p-4 mb-6">
          <h3 className="font-semibold mb-4">Nuevo reclamo</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label htmlFor="resident-ticket-title" className="block text-sm font-medium mb-1">Título</label>
              <input
                id="resident-ticket-title"
                type="text"
                value={newTicket.title}
                onChange={(e) => setNewTicket({ ...newTicket, title: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
                required
                placeholder="Describe brevemente lo que sucede"
                aria-invalid={!!error}
                aria-describedby={error ? 'resident-ticket-error' : undefined}
              />
            </div>
            <div>
              <label htmlFor="resident-ticket-description" className="block text-sm font-medium mb-1">Descripción</label>
              <textarea
                id="resident-ticket-description"
                value={newTicket.description}
                onChange={(e) => setNewTicket({ ...newTicket, description: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
                rows={4}
                required
                placeholder="Contá qué pasó, desde cuándo y si afecta a tu unidad"
                aria-invalid={!!error}
                aria-describedby={error ? 'resident-ticket-error' : undefined}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="resident-ticket-category" className="block text-sm font-medium mb-1">Categoría</label>
                <select
                  id="resident-ticket-category"
                  value={newTicket.category}
                  onChange={(e) => setNewTicket({ ...newTicket, category: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="MAINTENANCE">Mantenimiento</option>
                  <option value="REPAIR">Reparación</option>
                  <option value="CLEANING">Limpieza</option>
                  <option value="COMPLAINT">Reclamo</option>
                  <option value="SAFETY">Seguridad</option>
                  <option value="BILLING">Facturación</option>
                  <option value="OTHER">Otro</option>
                </select>
              </div>
            </div>
            {error && (
              <p id="resident-ticket-error" className="text-red-600 text-sm" aria-live="polite">
                {error}
              </p>
            )}
            {success && <p className="text-green-600 text-sm" aria-live="polite">{success}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creando...
                  </span>
                ) : (
                  'Crear reclamo'
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2 border rounded-md hover:bg-gray-50"
              >
                Cancelar
              </button>
            </div>
          </form>
        </Card>
      )}

      {(ticketsError || ticketsErrorValue) && (
        <Card className="p-4 mb-6 border-red-200 bg-red-50">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-red-600 mt-0.5" size={20} />
            <div className="space-y-1">
              <p className="font-medium text-red-800">No pudimos cargar tus reclamos</p>
              <p className="text-sm text-red-700">
                {ticketsErrorValue instanceof Error ? ticketsErrorValue.message : 'Intentá nuevamente en unos segundos.'}
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="text-sm font-medium text-red-700 hover:underline"
              >
                Reintentar
              </button>
            </div>
          </div>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : filteredTickets.length === 0 ? (
        <Card className="p-8 text-center">
          <CheckCircle className="w-12 h-12 mx-auto text-green-600 mb-4" />
          <p className="text-muted-foreground">Todavía no tenés reclamos abiertos.</p>
          <p className="text-sm text-muted-foreground mt-1">
            Si necesitás ayuda con tu unidad o edificio, podés crear uno desde arriba.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredTickets.map((ticket) => (
            <Card key={ticket.id} className="p-4 hover:shadow-md transition">
              <button
                type="button"
                className="w-full text-left focus:outline-none focus:ring-2 focus:ring-blue-500 rounded cursor-pointer"
                onClick={() => void openTicketDetail(ticket.id)}
                disabled={detailLoading}
                aria-label={`Ver reclamo ${ticket.title}`}
              >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium truncate">{ticket.title}</h3>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${priorityColor(ticket.priority)}`}>
                      {priorityLabel(ticket.priority)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">{ticket.description}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(ticket.createdAt)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Filter className="w-3 h-3" />
                      {ticketCategoryLabel(ticket.category)}
                    </span>
                  </div>
                </div>
                <div className={`font-medium text-sm ${statusColor(ticket.status)}`}>
                  {ticketStatusLabel(ticket.status)}
                </div>
              </div>
              <div className="flex items-center justify-end gap-1 mt-3 text-sm text-blue-600 font-medium">
                Ver reclamo
                <ChevronRight className="w-4 h-4" />
              </div>
              </button>
            </Card>
          ))}
        </div>
      )}

      {detailLoading && <p role="status" className="mt-4 text-sm text-muted-foreground">Cargando reclamo…</p>}
      {detailError && !selectedTicket && <p role="alert" className="mt-4 text-sm text-red-700">{detailError}</p>}
      {selectedTicket && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/50 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="resident-ticket-detail-title">
          <Card className="w-full max-h-[90vh] overflow-y-auto rounded-t-lg p-6 sm:mx-auto sm:w-[600px] sm:rounded-lg">
            <div className="flex items-start justify-between gap-4">
              <h2 id="resident-ticket-detail-title" className="text-xl font-semibold">{selectedTicket.title}</h2>
              <button type="button" onClick={() => setSelectedTicket(null)} aria-label="Cerrar detalle" className="text-gray-500">×</button>
            </div>
            <p className="mt-4 text-sm">{selectedTicket.description}</p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-muted-foreground">
              <span>Estado: {ticketStatusLabel(selectedTicket.status)}</span>
              <span>Prioridad: {priorityLabel(selectedTicket.priority)}</span>
              <span>Categoría: {ticketCategoryLabel(selectedTicket.category)}</span>
              <span>Fecha: {formatDate(selectedTicket.createdAt)}</span>
              <span>Unidad: {selectedTicket.unit?.label ?? selectedTicket.unit?.code ?? 'Tu unidad'}</span>
            </div>
            {detailError && <p role="alert" className="mt-3 text-sm text-red-700">{detailError}</p>}
            <div className="mt-6 space-y-3">
              <h3 className="font-medium">Comentarios ({selectedTicket.comments?.length ?? 0})</h3>
              {selectedTicket.comments?.length ? selectedTicket.comments.map((comment) => (
                <div key={comment.id} className="rounded bg-muted p-3 text-sm">
                  <p className="font-medium">{comment.author.name}</p>
                  <p className="mt-1">{comment.body}</p>
                </div>
              )) : <p className="text-sm text-muted-foreground">Todavía no hay comentarios.</p>}
              <textarea
                value={commentBody}
                onChange={(event) => setCommentBody(event.target.value)}
                placeholder="Escribí un comentario"
                rows={3}
                disabled={commentLoading}
                className="w-full rounded border p-2"
              />
              <button type="button" onClick={() => void submitComment()} disabled={commentLoading || !commentBody.trim()} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
                {commentLoading ? 'Enviando…' : 'Enviar comentario'}
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
