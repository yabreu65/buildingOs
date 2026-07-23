'use client';

import { useState } from 'react';
import { Card, Badge, Skeleton, ErrorState, EmptyState } from '@/shared/components/ui';
import { addComment, getTicket, updateTicket, type Ticket } from '@/features/tickets/services/tickets.api';
import { ticketCategoryLabel, ticketPriorityLabel, ticketStatusLabel } from '@/features/tickets/ticket-labels';
import type { TicketsReport, ReportTicket } from '../services/reports.api';

interface TicketsReportProps {
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
  data,
  loading,
  error,
  onRetry,
}: TicketsReportProps) {
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [status, setStatus] = useState<Ticket['status']>('OPEN');
  const [commentBody, setCommentBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const openTicket = async (ticket: ReportTicket) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const detail = await getTicket(ticket.buildingId, ticket.id);
      setSelectedTicket(detail);
      setStatus(detail.status);
      setCommentBody('');
      setSaveMessage(null);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'No pudimos cargar el reclamo.');
    } finally {
      setDetailLoading(false);
    }
  };

  const saveTicketChanges = async () => {
    if (!selectedTicket) return;
    setSaving(true);
    setDetailError(null);
    setSaveMessage(null);
    try {
      if (status !== selectedTicket.status) {
        await updateTicket(selectedTicket.building.id, selectedTicket.id, { status });
      }
      if (commentBody.trim()) {
        await addComment(selectedTicket.building.id, selectedTicket.id, { body: commentBody.trim() });
      }
      const refreshed = await getTicket(selectedTicket.building.id, selectedTicket.id);
      setSelectedTicket(refreshed);
      setStatus(refreshed.status);
      setCommentBody('');
      setSaveMessage('Cambios guardados correctamente.');
      onRetry?.();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'No pudimos guardar los cambios.');
    } finally {
      setSaving(false);
    }
  };

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
              <button key={ticket.id} type="button" onClick={() => void openTicket(ticket)} className="w-full rounded-lg border border-border bg-card p-4 text-left hover:bg-muted" aria-label={`Ver reclamo ${ticket.title}`}>
                <div className="flex items-center justify-between gap-3"><span className="font-medium">{ticket.title}</span><Badge>{ticketStatusLabel(ticket.status)}</Badge></div>
                <p className="mt-1 text-sm text-muted-foreground">{ticket.building.name}{ticket.unit ? ` · ${ticket.unit.label ?? ticket.unit.code}` : ''} · {ticketCategoryLabel(ticket.category)} · {ticketPriorityLabel(ticket.priority)}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {detailLoading && <div role="status" className="text-sm text-muted-foreground">Cargando reclamo…</div>}
      {detailError && <ErrorState message={detailError} />}
      {selectedTicket && (
        <div role="dialog" aria-modal="true" aria-labelledby="ticket-detail-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6">
            <div className="flex items-start justify-between gap-4"><h2 id="ticket-detail-title" className="text-xl font-bold">{selectedTicket.title}</h2><button type="button" onClick={() => setSelectedTicket(null)} aria-label="Cerrar detalle">Cerrar</button></div>
            <p className="mt-4 text-sm">{selectedTicket.description}</p>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm"><span>Prioridad: {ticketPriorityLabel(selectedTicket.priority)}</span><span>Categoría: {ticketCategoryLabel(selectedTicket.category)}</span><span>Creado: {new Date(selectedTicket.createdAt).toLocaleString()}</span></div>
            <label className="mt-4 block text-sm font-medium" htmlFor="report-ticket-status">Estado</label>
            <select id="report-ticket-status" value={status} onChange={(event) => setStatus(event.target.value as Ticket['status'])} disabled={saving} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="OPEN">Abierto</option>
              <option value="IN_PROGRESS">En progreso</option>
              <option value="RESOLVED">Resuelto</option>
              <option value="CLOSED">Cerrado</option>
            </select>
            <h3 className="mt-6 font-semibold">Comentarios ({selectedTicket.comments?.length ?? 0})</h3>
            <div className="mt-2 space-y-2">{selectedTicket.comments?.map((comment) => <div key={comment.id} className="rounded border border-border p-3 text-sm"><p>{comment.body}</p><p className="mt-1 text-xs text-muted-foreground">{comment.author.name}</p></div>)}</div>
            <label className="mt-4 block text-sm font-medium" htmlFor="report-ticket-comment">Respuesta administrativa</label>
            <textarea id="report-ticket-comment" value={commentBody} onChange={(event) => setCommentBody(event.target.value)} disabled={saving} rows={3} className="mt-1 w-full rounded-md border border-input bg-background p-2 text-sm" placeholder="Escribí una respuesta" />
            {saveMessage && <p className="mt-2 text-sm text-green-600" role="status">{saveMessage}</p>}
            <button type="button" onClick={() => void saveTicketChanges()} disabled={saving || (status === selectedTicket.status && !commentBody.trim())} className="mt-3 rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </Card>
        </div>
      )}
    </div>
  );
}
