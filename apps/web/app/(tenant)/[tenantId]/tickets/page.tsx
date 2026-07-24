'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight, FolderTree, Ticket } from 'lucide-react';
import Card from '@/shared/components/ui/Card';
import EmptyState from '@/shared/components/ui/EmptyState';
import Button from '@/shared/components/ui/Button';
import Skeleton from '@/shared/components/ui/Skeleton';
import { useBuildings } from '@/features/buildings/hooks';

interface Params {
  tenantId: string;
  [key: string]: string | string[];
}

export default function TicketsIndexPage() {
  const params = useParams<Params>();
  const tenantId = params?.tenantId;
  const { buildings, loading, error, refetch } = useBuildings(tenantId);

  if (!tenantId) {
    return <div>Invalid parameters</div>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Tickets y reclamos</h1>
        <p className="text-sm text-muted-foreground">
          Elegí un edificio para ver y gestionar reclamos operativos.
        </p>
      </div>

      <Card className="border-dashed p-4">
        <div className="flex items-start gap-3">
          <FolderTree className="mt-0.5 h-5 w-5 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Acceso por edificio</p>
            <p className="text-sm text-muted-foreground">
              Los tickets operativos se organizan por edificio. El soporte SaaS continúa en{' '}
              <Link className="underline" href={`/${tenantId}/support`}>
                /support
              </Link>
              .
            </p>
          </div>
        </div>
      </Card>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      )}

      {error && !loading && (
        <Card className="border-red-200 bg-red-50 p-5">
          <div className="space-y-3 text-center">
            <p className="text-lg font-semibold text-red-900">No pudimos cargar los edificios</p>
            <p className="text-sm text-red-700">{error}</p>
            <Button onClick={() => void refetch()} variant="secondary" size="sm">
              Reintentar
            </Button>
          </div>
        </Card>
      )}

      {!loading && !error && buildings.length === 0 && (
        <EmptyState
          icon={<Ticket className="h-10 w-10" />}
          title="No hay edificios disponibles"
          description="Todavía no tenés edificios cargados para ver tickets operativos."
        />
      )}

      {!loading && !error && buildings.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {buildings.map((building) => (
            <Card key={building.id} className="p-5">
              <div className="space-y-3">
                <div>
                  <h2 className="text-lg font-semibold">{building.name}</h2>
                  {building.address && (
                    <p className="text-sm text-muted-foreground">{building.address}</p>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">Ver tickets del edificio</span>
                  <Link
                    href={`/${tenantId}/buildings/${building.id}/tickets`}
                    className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-500"
                  >
                    Abrir
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
