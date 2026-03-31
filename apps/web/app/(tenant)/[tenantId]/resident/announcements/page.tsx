'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  getResidentCommunications,
  markResidentAsRead,
  type ResidentCommunicationItem,
} from '@/features/communications/services/communications.api';
import { useTenantId } from '@/features/tenancy/tenant.hooks';
import { BuildingIcon, Bell, CheckCircle2, Circle, ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { routes } from '@/shared/lib/routes';

export default function ResidentAnnouncementsPage() {
  const tenantId = useTenantId();
  const [communications, setCommunications] = useState<ResidentCommunicationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);

  const fetchCommunications = useCallback(async (cursor?: string, isLoadMore = false) => {
    if (!tenantId) return;

    try {
      if (isLoadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const response = await getResidentCommunications(20, cursor);

      if (isLoadMore) {
        setCommunications((prev) => [...prev, ...response.items]);
      } else {
        setCommunications(response.items);
      }

      setNextCursor(response.nextCursor);
      setHasMore(!!response.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar comunicados');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchCommunications();
  }, [fetchCommunications]);

  const handleMarkAsRead = async (communicationId: string) => {
    try {
      const result = await markResidentAsRead(communicationId);
      setCommunications((prev) =>
        prev.map((c) =>
          c.id === communicationId
            ? { ...c, deliveryStatus: 'READ' as const, readAt: result.readAt }
            : c
        )
      );
    } catch (err) {
      console.error('Failed to mark as read:', err);
    }
  };

  const handleLoadMore = () => {
    if (nextCursor && !loadingMore) {
      fetchCommunications(nextCursor, true);
    }
  };

  const handleCardClick = (comm: ResidentCommunicationItem) => {
    if (comm.deliveryStatus === 'UNREAD') {
      handleMarkAsRead(comm.id);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-AR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-500">{error}</p>
        <button
          onClick={() => fetchCommunications()}
          className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Bell className="w-6 h-6" />
            Comunicados
          </h1>
          <p className="text-muted-foreground mt-1">
            Mantente informado sobre las novedades de tu edificio
          </p>
        </div>
      </div>

      {communications.length === 0 ? (
        <div className="text-center py-12">
          <Bell className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No hay comunicados disponibles</p>
        </div>
      ) : (
        <div className="space-y-4">
          {communications.map((comm) => (
            <div
              key={comm.id}
              onClick={() => handleCardClick(comm)}
              className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                comm.deliveryStatus === 'UNREAD'
                  ? 'bg-card border-border hover:bg-accent'
                  : 'bg-card/50 border-border hover:bg-accent/50'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  {comm.deliveryStatus === 'UNREAD' ? (
                    <Circle className="w-5 h-5 mt-0.5 text-primary fill-primary" />
                  ) : (
                    <CheckCircle2 className="w-5 h-5 mt-0.5 text-muted-foreground" />
                  )}
                  <div>
                    <h3 className={`font-medium ${comm.deliveryStatus === 'UNREAD' ? '' : 'text-muted-foreground'}`}>
                      {comm.title}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {comm.body}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      {comm.publishedAt && (
                        <span>{formatDate(comm.publishedAt)}</span>
                      )}
                      {comm.priority === 'URGENT' && (
                        <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">
                          Urgente
                        </span>
                      )}
                      {comm.scopeType === 'BUILDING' && comm.buildingIds.length > 0 && (
                        <span className="flex items-center gap-1">
                          <BuildingIcon className="w-3 h-3" />
                          Edificio específico
                        </span>
                      )}
                      {comm.scopeType === 'TENANT_ALL' && (
                        <span>Todos los edificios</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {hasMore && (
            <div className="flex justify-center py-4">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {loadingMore ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Cargando...
                  </span>
                ) : (
                  'Ver más'
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
