'use client';

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react';
import Card from '@/shared/components/ui/Card';
import EmptyState from '@/shared/components/ui/EmptyState';
import Skeleton from '@/shared/components/ui/Skeleton';
import { useAuth } from '@/features/auth';
import { TicketDetail } from '@/features/tickets';
import { addComment, updateTicket } from '@/features/tickets/services/tickets.api';
import { ticketDetailKeys, useTicketDetail } from '@/features/tickets/hooks/useTicketDetail';

interface TicketParams {
  tenantId: string;
  ticketId: string;
  [key: string]: string | string[];
}

export default function TicketDetailPage() {
  const params = useParams<TicketParams>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();

  const tenantId = params?.tenantId;
  const ticketId = params?.ticketId;

  const { data: ticket, isLoading, error, refetch } = useTicketDetail(tenantId, ticketId);

  const canManageTicket = useMemo(() => {
    return currentUser?.roles?.some((role) => ['TENANT_ADMIN', 'TENANT_OWNER', 'OPERATOR'].includes(role)) ?? false;
  }, [currentUser?.roles]);
  const isResident = useMemo(
    () => currentUser?.roles?.includes('RESIDENT') && !canManageTicket,
    [canManageTicket, currentUser?.roles],
  );
  const fallbackPath = isResident ? `/${tenantId}/resident/tickets` : `/${tenantId}/tickets`;

  const handleBack = () => {
    if (typeof window !== 'undefined' && document.referrer.startsWith(window.location.origin)) {
      router.back();
      return;
    }

    router.push(fallbackPath);
  };

  const refreshTicket = async () => {
    if (!tenantId || !ticket) return;
    await queryClient.invalidateQueries({ queryKey: ticketDetailKeys.byTenant(tenantId, ticket.id) });
    await refetch();
  };

  const handleStatusChange = async (_ticketId: string, newStatus: string) => {
    if (!ticket) return;

    await updateTicket(ticket.building.id, ticket.id, { status: newStatus as 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' });
    await refreshTicket();
  };

  const handlePriorityChange = async (_ticketId: string, newPriority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT') => {
    if (!ticket) return;

    await updateTicket(ticket.building.id, ticket.id, { priority: newPriority });
    await refreshTicket();
  };

  const handleAddComment = async (_ticketId: string, body: string) => {
    if (!ticket) return;

    await addComment(ticket.building.id, ticket.id, { body });
    await refreshTicket();
  };

  const handleAssign = async (_ticketId: string, membershipId: string) => {
    if (!ticket) return;

    await updateTicket(ticket.building.id, ticket.id, { assignedToMembershipId: membershipId || null });
    await refreshTicket();
  };

  if (!tenantId || !ticketId) {
    return (
      <div className="flex items-center justify-center py-12">
        <EmptyState
          icon={<AlertCircle className="w-10 h-10 text-red-500" />}
          title="Parámetros inválidos"
          description="Faltan tenantId o ticketId en la ruta."
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando ticket...
        </div>
        <div className="space-y-2">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-5 w-96" />
        </div>
        <Card className="p-6 space-y-4">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </Card>
      </div>
    );
  }

  if (error) {
    const status = typeof error === 'object' && error && 'status' in error
      ? Number((error as { status?: number }).status)
      : undefined;
    const message = error instanceof Error ? error.message : 'No se pudo cargar el ticket.';

    const copy = status === 403
      ? 'No tenés permisos para ver este ticket.'
      : status === 404
        ? 'El ticket no existe o no está disponible en este tenant.'
        : message;

    return (
      <EmptyState
        icon={<AlertCircle className="w-10 h-10 text-red-500" />}
        title={status === 404 ? 'Ticket no encontrado' : status === 403 ? 'Acceso denegado' : 'No se pudo cargar el ticket'}
        description={copy}
        cta={{ text: 'Reintentar', onClick: () => void refetch() }}
      />
    );
  }

  if (!ticket) {
    return (
      <EmptyState
        icon={<AlertCircle className="w-10 h-10 text-red-500" />}
        title="Ticket no encontrado"
        description="No pudimos encontrar información para este ticket."
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-sm uppercase tracking-wide text-muted-foreground">Tickets y reclamos</p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Detalle del ticket</h1>
        <p className="text-sm text-muted-foreground">
          {ticket.building.name} · {ticket.unit ? `${ticket.unit.label} (${ticket.unit.code})` : 'Sin unidad asociada'}
        </p>
      </header>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <TicketDetail
          key={ticket.id}
          tenantId={tenantId}
          ticket={ticket}
          variant="page"
          onBack={handleBack}
          onStatusChange={canManageTicket ? handleStatusChange : async () => undefined}
          onPriorityChange={canManageTicket ? handlePriorityChange : undefined}
          onAddComment={handleAddComment}
          onAssign={canManageTicket ? handleAssign : undefined}
        />
      </div>
    </div>
  );
}
