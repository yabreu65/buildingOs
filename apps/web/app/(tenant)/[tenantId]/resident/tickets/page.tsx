'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  MessageSquare,
  Plus,
  AlertCircle,
  Clock,
  CheckCircle,
  Loader2,
  Filter,
} from 'lucide-react';
import { useResidentContext } from '../../../../../features/resident/hooks/useResidentContext';
import { getResidentTickets } from '../../../../../features/resident/api/resident-context.api';
import { createTicket, type Ticket } from '../../../../../features/tickets/services/tickets.api';
import { useTenants } from '../../../../../features/tenants/tenants.hooks';
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
  
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTicket, setNewTicket] = useState({
    title: '',
    description: '',
    category: 'GENERAL',
    priority: 'MEDIUM' as Ticket['priority'],
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data: tenants } = useTenants();
  const tenantName = tenants?.find((t) => t.id === tenantId)?.name ?? tenantId;

  const { data: context, isLoading: contextLoading } = useResidentContext(tenantId ?? null);
  const buildingId = context?.activeBuildingId;
  const unitId = context?.activeUnitId;

  const { data: tickets = [], isLoading, refetch } = useQuery<Ticket[]>({
    queryKey: ['residentTickets', buildingId, unitId],
    queryFn: () => getResidentTickets(buildingId!, unitId!, 50),
    enabled: !!buildingId && !!unitId,
    staleTime: 2 * 60 * 1000,
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!buildingId || !unitId) return;

    setCreating(true);
    setError(null);
    setSuccess(null);

    try {
      await createTicket(buildingId, {
        ...newTicket,
        unitId,
      });
      setSuccess('Ticket creado correctamente');
      setNewTicket({
        title: '',
        description: '',
        category: 'GENERAL',
        priority: 'MEDIUM',
      });
      setShowCreateForm(false);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear ticket');
    } finally {
      setCreating(false);
    }
  };

  const statusFilter = 'all';
  const filteredTickets = statusFilter === 'all' 
    ? tickets 
    : tickets.filter(t => t.status === statusFilter);

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

  if (!buildingId || !unitId) {
    return (
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <MessageSquare className="w-6 h-6" />
          Mis Tickets
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
            Mis Tickets
          </h1>
          <p className="text-muted-foreground mt-1">{tenantName}</p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          <Plus className="w-4 h-4" />
          Crear ticket
        </button>
      </div>

      {showCreateForm && (
        <Card className="p-4 mb-6">
          <h3 className="font-semibold mb-4">Nuevo ticket</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Título</label>
              <input
                type="text"
                value={newTicket.title}
                onChange={(e) => setNewTicket({ ...newTicket, title: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
                required
                placeholder="Describe brevemente el problema"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Descripción</label>
              <textarea
                value={newTicket.description}
                onChange={(e) => setNewTicket({ ...newTicket, description: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
                rows={4}
                required
                placeholder="Detalles del problema..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Categoría</label>
                <select
                  value={newTicket.category}
                  onChange={(e) => setNewTicket({ ...newTicket, category: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="GENERAL">General</option>
                  <option value="MANTENIMIENTO">Mantenimiento</option>
                  <option value="RUIDO">Ruido</option>
                  <option value="SEGURIDAD">Seguridad</option>
                  <option value="OTROS">Otros</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Prioridad</label>
                <select
                  value={newTicket.priority}
                  onChange={(e) => setNewTicket({ ...newTicket, priority: e.target.value as Ticket['priority'] })}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="LOW">Baja</option>
                  <option value="MEDIUM">Media</option>
                  <option value="HIGH">Alta</option>
                  <option value="URGENT">Urgente</option>
                </select>
              </div>
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            {success && <p className="text-green-600 text-sm">{success}</p>}
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
                  'Crear ticket'
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

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : filteredTickets.length === 0 ? (
        <Card className="p-8 text-center">
          <CheckCircle className="w-12 h-12 mx-auto text-green-600 mb-4" />
          <p className="text-muted-foreground">No tenés tickets abiertos</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredTickets.map((ticket) => (
            <Card key={ticket.id} className="p-4 hover:shadow-md transition">
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
                      {ticket.category}
                    </span>
                  </div>
                </div>
                <div className={`font-medium text-sm ${statusColor(ticket.status)}`}>
                  {ticketStatusLabel(ticket.status)}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
