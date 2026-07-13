'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useHitlWorkqueue } from '@/features/hitl/useHitlWorkqueue';
import { Button, Card, ErrorState, Skeleton, useToast } from '@/shared/components/ui';

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
] as const;

export default function HitlWorkqueuePage() {
  const params = useParams();
  const tenantId = params.tenantId as string;

  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]['value']>('open');
  const [fallbackPath, setFallbackPath] = useState('');

  const { items, loading, error, list, assignToMe } = useHitlWorkqueue();
  const { toast } = useToast();

  const filteredItems = useMemo(() => items, [items]);

  useEffect(() => {
    list({
      status,
      tenantId,
      fallbackPath: fallbackPath.trim() || undefined,
      limit: 50,
    }).catch(() => undefined);
  }, [list, status, fallbackPath, tenantId]);

  const handleAssign = async (id: string) => {
    try {
      await assignToMe(id);
      toast('Handoff asignado', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo asignar', 'error');
    }
  };

  if (loading && filteredItems.length === 0) {
    return (
      <div className="p-6 space-y-3">
        <h1 className="text-3xl font-bold">HITL Workqueue</h1>
        <Skeleton className="h-20 rounded" />
        <Skeleton className="h-20 rounded" />
        <Skeleton className="h-20 rounded" />
      </div>
    );
  }

  if (error && filteredItems.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-3xl font-bold mb-4">HITL Workqueue</h1>
        <ErrorState message={error} onRetry={() => list({ status, tenantId, limit: 50 })} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">HITL Workqueue</h1>
        <p className="text-gray-600 mt-2">Managed Service handoffs para resolución operativa.</p>
      </div>

      <Card className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-sm font-medium block mb-2">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as (typeof STATUS_OPTIONS)[number]['value'])}
              className="w-full px-3 py-2 border rounded-md"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium block mb-2">Fallback Path</label>
            <input
              value={fallbackPath}
              onChange={(e) => setFallbackPath(e.target.value)}
              placeholder="intent_library_tool_error"
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>

          <div className="flex items-end">
            <Button
              variant="secondary"
              onClick={() => list({ status, tenantId, fallbackPath: fallbackPath.trim() || undefined, limit: 50 })}
            >
              Refrescar
            </Button>
          </div>
        </div>
      </Card>

      <div className="space-y-3">
        {filteredItems.length === 0 ? (
          <Card className="p-6 text-gray-600">No hay handoffs para los filtros actuales.</Card>
        ) : (
          filteredItems.map((handoff) => (
            <Card key={handoff.id} className="p-4">
              <div className="flex justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <p className="font-semibold truncate">{handoff.question}</p>
                  <p className="text-xs text-gray-500">Trace ID: {handoff.traceId}</p>
                  <p className="text-xs text-gray-500">Fallback: {handoff.fallbackPath}</p>
                  <p className="text-xs text-gray-500">Status: {handoff.status}</p>
                </div>

                <div className="flex items-start gap-2 shrink-0">
                  <Button size="sm" variant="secondary" onClick={() => handleAssign(handoff.id)}>
                    Assign to me
                  </Button>
                  <Link href={`/${tenantId}/admin/hitl/${handoff.id}`}>
                    <Button size="sm" variant="primary">Ver detalle</Button>
                  </Link>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
