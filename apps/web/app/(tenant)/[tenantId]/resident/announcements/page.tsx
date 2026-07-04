'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  getResidentCommunications,
  markResidentAsRead,
  type ResidentCommunicationItem,
} from '@/features/communications/services/communications.api';
import { useTenantId } from '@/features/tenancy/tenant.hooks';
import { BuildingIcon, Bell, CheckCircle2, Circle, Loader2, AlertCircle } from 'lucide-react';
import Card from '@/shared/components/ui/Card';

const ResidentAnnouncementsPage = () => {
  const tenantId = useTenantId();
  const [communications, setCommunications] = useState<ResidentCommunicationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markReadError, setMarkReadError] = useState<string | null>(null);
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
      setMarkReadError(null);
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
      setMarkReadError(
        err instanceof Error
          ? err.message
          : 'No pudimos marcar el aviso como leído. Intenta nuevamente.'
      );
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
      <Card className="p-6 border-red-200 bg-red-50">
        <div className="flex items-start gap-3">
          <AlertCircle className="text-red-600 mt-0.5" size={20} />
          <div className="space-y-1">
            <p className="font-medium text-red-800">No pudimos cargar los comunicados</p>
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
        <button
          onClick={() => fetchCommunications()}
          type="button"
          className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md"
        >
          Reintentar
        </button>
      </Card>
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

      {markReadError && (
        <Card className="p-4 mb-4 border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-800">{markReadError}</p>
          <button
            type="button"
            onClick={() => setMarkReadError(null)}
            className="mt-2 text-sm font-medium text-amber-800 hover:underline"
          >
            Cerrar
          </button>
        </Card>
      )}

      {communications.length === 0 ? (
        <div className="text-center py-12">
          <Bell className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No tenés comunicados para mostrar por ahora.</p>
          <p className="text-sm text-muted-foreground mt-1">
            Cuando la administración publique novedades para tu edificio, las vas a ver acá.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {communications.map((comm) => (
            <button
              type="button"
              key={comm.id}
              onClick={() => handleCardClick(comm)}
              className={`w-full text-left p-4 rounded-lg border transition-colors ${
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
            </button>
          ))}

          {hasMore && (
            <div className="flex justify-center py-4">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                type="button"
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
};

export default ResidentAnnouncementsPage;
