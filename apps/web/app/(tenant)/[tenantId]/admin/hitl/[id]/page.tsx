'use client';

import Link from 'next/link';
import { useEffect, useState, type ChangeEvent } from 'react';
import { useParams } from 'next/navigation';
import { useHitlWorkqueue } from '@/features/hitl/useHitlWorkqueue';
import { Button, Card, ErrorState, Skeleton, useToast } from '@/shared/components/ui';
import Textarea from '@/shared/components/ui/Textarea';

export default function HitlHandoffDetailPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;
  const handoffId = params.id as string;

  const { getById, assignToMe, resolve, dismiss } = useHitlWorkqueue();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [notifyUser, setNotifyUser] = useState(false);
  const [handoff, setHandoff] = useState<Awaited<ReturnType<typeof getById>> | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getById(handoffId);
      setHandoff(result);
      setResolutionNote(result.resolutionNote ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el handoff');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => undefined);
  }, [handoffId]);

  const handleAssign = async () => {
    try {
      const updated = await assignToMe(handoffId);
      setHandoff((prev) => (prev ? { ...prev, ...updated } : prev));
      toast('Asignado correctamente', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo asignar', 'error');
    }
  };

  const handleResolve = async () => {
    if (!resolutionNote.trim()) {
      toast('La resolutionNote es obligatoria', 'error');
      return;
    }

    try {
      const updated = await resolve(handoffId, resolutionNote, notifyUser);
      setHandoff((prev) => (prev ? { ...prev, ...updated } : prev));
      toast(
        `Respuesta registrada (traceId: ${updated.traceId})${updated.notifyEnqueued ? ' y notificación encolada' : ''}`,
        'success',
      );
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo resolver', 'error');
    }
  };

  const handleDismiss = async () => {
    try {
      const updated = await dismiss(handoffId);
      setHandoff((prev) => (prev ? { ...prev, ...updated } : prev));
      toast('Handoff descartado', 'success');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo descartar', 'error');
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-44 rounded" />
      </div>
    );
  }

  if (error || !handoff) {
    return (
      <div className="p-6">
        <ErrorState message={error || 'Handoff no encontrado'} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Handoff {handoff.id}</h1>
          <p className="text-sm text-gray-600">Trace ID: {handoff.traceId}</p>
          <p className="text-sm text-gray-600">Fallback: {handoff.fallbackPath}</p>
        </div>
        <Link href={`/${tenantId}/admin/hitl`}>
          <Button variant="secondary">Volver</Button>
        </Link>
      </div>

      <Card className="p-4 space-y-2">
        <p><strong>Status:</strong> {handoff.status}</p>
        <p><strong>Tenant:</strong> {handoff.tenantId}</p>
        <p><strong>Usuario:</strong> {handoff.userId}</p>
        <p><strong>Assigned To:</strong> {handoff.assignedToUserId || '—'}</p>
        <p><strong>Gateway Outcome:</strong> {handoff.gatewayOutcome}</p>
        <p><strong>Question:</strong> {handoff.question}</p>
      </Card>

      <Card className="p-4 space-y-3">
        <h2 className="text-lg font-semibold">Resolver handoff</h2>
        <Textarea
          value={resolutionNote}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setResolutionNote(e.target.value)}
          rows={5}
          placeholder="Escribí la nota de resolución..."
        />
        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={notifyUser}
            onChange={(e) => setNotifyUser(e.target.checked)}
          />
          Notificar al usuario
        </label>

        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleAssign}>Assign to me</Button>
          <Button variant="primary" onClick={handleResolve}>Resolve</Button>
          <Button variant="danger" onClick={handleDismiss}>Dismiss</Button>
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <h2 className="text-lg font-semibold">Audit Log</h2>
        {handoff.audits.length === 0 ? (
          <p className="text-sm text-gray-600">Sin eventos de auditoría.</p>
        ) : (
          <ul className="space-y-2">
            {handoff.audits.map((audit) => (
              <li key={audit.id} className="text-sm border rounded-md p-2">
                <div><strong>{audit.action}</strong></div>
                <div>actorUserId: {audit.actorUserId}</div>
                <div>{new Date(audit.createdAt).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
