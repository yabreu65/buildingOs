'use client';

import { useState, useEffect } from 'react';
import { useSupportTickets } from '@/features/support-tickets/useSupportTickets';
import {
  Card,
  Button,
  Badge,
  EmptyState,
  ErrorState,
  Skeleton,
  useToast,
} from '@/shared/components/ui';

export default function SupportTicketsPage() {
  const [status, setStatus] = useState<string>('');
  const [skip, setSkip] = useState(0);
  const take = 50;
  const statusFilterId = 'super-admin-support-status-filter';

  const { tickets, total, loading, error, fetch, updateStatus } = useSupportTickets(
    undefined,
    true
  );

  const { toast } = useToast();

  // Fetch tickets on mount and when filters change
  useEffect(() => {
    fetch({ status: status || undefined, skip, take });
  }, [status, skip, fetch]);

  const handleStatusChange = async (ticketId: string, newStatus: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED') => {
    try {
      await updateStatus(ticketId, newStatus);
      toast('Estado del reclamo actualizado', 'success');
      fetch({ status: status || undefined, skip, take });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo actualizar el estado', 'error');
    }
  };

  const statusColors: Record<string, string> = {
    OPEN: 'bg-blue-100 text-blue-900',
    IN_PROGRESS: 'bg-yellow-100 text-yellow-900',
    RESOLVED: 'bg-green-100 text-green-900',
    CLOSED: 'bg-gray-100 text-gray-900',
  };

  const priorityColors: Record<string, string> = {
    LOW: 'bg-blue-100 text-blue-900',
    MEDIUM: 'bg-yellow-100 text-yellow-900',
    HIGH: 'bg-orange-100 text-orange-900',
    URGENT: 'bg-red-100 text-red-900',
  };

  const formatCategory = (category: string) => {
    if (category === 'BILLING') return 'Cobranza';
    if (category === 'ACCESS') return 'Acceso';
    if (category === 'TECHNICAL') return 'Técnico';
    if (category === 'ACCOUNT') return 'Cuenta';
    return category.replace(/_/g, ' ');
  };

  if (loading && tickets.length === 0) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-3xl font-bold">Reclamos de soporte</h1>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error && tickets.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-3xl font-bold mb-6">Reclamos de soporte</h1>
        <ErrorState
          message={error}
          onRetry={() => fetch({ status: status || undefined, skip, take })}
        />
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-3xl font-bold mb-6">Reclamos de soporte</h1>
        <EmptyState
          title="Sin reclamos de soporte"
          description="Todavía no hay reclamos para mostrar"
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Reclamos de soporte</h1>
        <p className="text-gray-600 mt-2">Seguimiento centralizado de solicitudes de las administradoras</p>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label htmlFor={statusFilterId} className="block text-sm font-medium mb-2">
              Estado
            </label>
            <select
              id={statusFilterId}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setSkip(0);
              }}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="">Todos los estados</option>
              <option value="OPEN">Abierto</option>
              <option value="IN_PROGRESS">En progreso</option>
              <option value="RESOLVED">Resuelto</option>
              <option value="CLOSED">Cerrado</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Tickets List */}
      <div className="space-y-3">
        {tickets.map((ticket) => (
          <Card key={ticket.id} className="p-4">
            <div className="flex justify-between items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-semibold truncate">{ticket.title}</h3>
                  <Badge className={statusColors[ticket.status]}>
                    {ticket.status === 'OPEN'
                      ? 'Abierto'
                      : ticket.status === 'IN_PROGRESS'
                        ? 'En progreso'
                        : ticket.status === 'RESOLVED'
                          ? 'Resuelto'
                          : 'Cerrado'}
                  </Badge>
                  <Badge className={priorityColors[ticket.priority]}>
                    {ticket.priority === 'LOW'
                      ? 'Baja'
                      : ticket.priority === 'MEDIUM'
                        ? 'Media'
                        : ticket.priority === 'HIGH'
                          ? 'Alta'
                          : 'Urgente'}
                  </Badge>
                </div>
                <p className="text-sm text-gray-600 mb-2">{ticket.description}</p>
                <div className="flex gap-4 text-xs text-gray-500">
                  <span>De: <strong>{ticket.createdBy.name}</strong></span>
                  <span>Categoría: <strong>{formatCategory(ticket.category)}</strong></span>
                  <span>Creado: <strong>{new Date(ticket.createdAt).toLocaleDateString()}</strong></span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-4 pt-4 border-t flex gap-2 flex-wrap">
              {ticket.status !== 'CLOSED' && (
                <select
                  aria-label={`Cambiar estado del reclamo ${ticket.title}`}
                  onChange={(e) => {
                    if (!e.target.value) {
                      return;
                    }
                    const newStatus = e.target.value as 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
                    handleStatusChange(ticket.id, newStatus);
                  }}
                  className="px-3 py-1 text-sm border rounded"
                >
                  <option value="">Cambiar estado</option>
                  {ticket.status === 'OPEN' && (
                    <>
                      <option value="IN_PROGRESS">Mover a En progreso</option>
                      <option value="CLOSED">Cerrar</option>
                    </>
                  )}
                  {ticket.status === 'IN_PROGRESS' && (
                    <>
                      <option value="RESOLVED">Marcar Resuelto</option>
                      <option value="CLOSED">Cerrar</option>
                    </>
                  )}
                  {ticket.status === 'RESOLVED' && (
                    <option value="CLOSED">Cerrar</option>
                  )}
                </select>
              )}
              <Button variant="secondary" size="sm" disabled aria-label={`Ver detalles del reclamo ${ticket.title}`}>
                Ver detalles
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {/* Pagination Info */}
      <div className="text-sm text-gray-600 text-center py-4">
        Mostrando {skip + 1} a {Math.min(skip + take, total)} de {total} reclamos
      </div>
    </div>
  );
}
