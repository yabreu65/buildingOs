'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { fetchBuildings } from '@/features/buildings/services/buildings.api';
import Skeleton from '@/shared/components/ui/Skeleton';

interface Params {
  tenantId: string;
  [key: string]: string | string[];
}

export default function CommunicationsRedirectPage() {
  const router = useRouter();
  const params = useParams<Params>();
  const tenantId = params?.tenantId;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;

    fetchBuildings(tenantId)
      .then((buildings) => {
        if (buildings.length > 0) {
          router.replace(`/${tenantId}/buildings/${buildings[0].id}/communications`);
        } else {
          setError('No hay edificios disponibles');
        }
      })
      .catch(() => {
        setError('Error al cargar edificios');
      });
  }, [tenantId, router]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">{error}</p>
        <button
          onClick={() => router.push(`/${tenantId}/dashboard`)}
          className="mt-4 text-sm text-blue-600 hover:text-blue-500"
        >
          Volver al dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
