'use client';

import Link from 'next/link';
import { Card, Badge, Skeleton, ErrorState, EmptyState } from '@/shared/components/ui';
import { ticketCategoryLabel, ticketPriorityLabel, ticketStatusLabel } from '@/features/tickets/ticket-labels';
import type { TicketsReport } from '../services/reports.api';
import { ticketDetailPath } from '@/shared/lib/routes';

interface TicketsReportProps {
  tenantId: string;
  data: TicketsReport | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
}

// Simple table-like div layout
function SimpleTable({ headers, rows }: { headers: string[], rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <div className="min-w-[380px]">
      <div className="border-b border-border bg-muted text-muted-foreground">
        <div className="grid gap-4 p-3" style={{ gridTemplateColumns: `repeat(${headers.length}, 1fr)` }}>
          {headers.map((h) => <div key={h} className="font-semibold text-sm">{h}</div>)}
        </div>
      </div>
      <div>
        {rows.map((row, i) => (
          <div key={i} className="grid gap-4 border-b border-border p-3 last:border-b-0" style={{ gridTemplateColumns: `repeat(${headers.length}, 1fr)` }}>
            {row.map((cell, j) => <div key={j} className="text-sm">{cell}</div>)}
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}

export function TicketsReportComponent({
  tenantId,
  data,
  loading,
  error,
  onRetry,
}: TicketsReportProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }

  if (!data) {
    return <EmptyState title="Sin datos" description="No hay datos disponibles" />;
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Respuesta Promedio</div>
          <div className="text-2xl font-bold">{data.avgTimeToFirstResponseHours}h</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Resolución Promedio</div>
          <div className="text-2xl font-bold">{data.avgTimeToResolveHours}h</div>
        </Card>
      </div>

      {/* By Status */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Por Estado</h3>
        <SimpleTable
          headers={['Estado', 'Cantidad']}
          rows={data.byStatus.map((item) => [
            <Badge key={item.status} className="border border-border bg-muted text-foreground">{ticketStatusLabel(item.status)}</Badge>,
            item.count,
          ])}
        />
      </div>

      {/* By Priority */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Por Prioridad</h3>
        <SimpleTable
          headers={['Prioridad', 'Cantidad']}
          rows={data.byPriority.map((item) => [
            <Badge key={item.priority} className="border border-border bg-muted text-foreground">{ticketPriorityLabel(item.priority)}</Badge>,
            item.count,
          ])}
        />
      </div>

      {/* Top Categories */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Categorías Principales</h3>
        <SimpleTable
          headers={['Categoría', 'Cantidad']}
          rows={data.topCategories.map((item) => [
            ticketCategoryLabel(item.category),
            item.count,
          ])}
        />
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4">Reclamos</h3>
        {data.tickets.length === 0 ? <EmptyState title="Sin reclamos" description="No hay reclamos en el período seleccionado" /> : (
          <div className="space-y-2">
            {data.tickets.map((ticket) => (
              <Link
                key={ticket.id}
                href={ticketDetailPath(tenantId, ticket.id)}
                className="block rounded-lg border border-border bg-card p-4 text-left hover:bg-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label={`Ver reclamo ${ticket.title}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{ticket.title}</span>
                  <Badge>{ticketStatusLabel(ticket.status)}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {ticket.building.name}{ticket.unit ? ` · ${ticket.unit.label ?? ticket.unit.code}` : ''} · {ticketCategoryLabel(ticket.category)} · {ticketPriorityLabel(ticket.priority)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
