'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

interface Params {
  tenantId: string;
  [key: string]: string | string[];
}

export default function AliasCargosPage() {
  const router = useRouter();
  const params = useParams<Params>();
  const tenantId = params?.tenantId;

  useEffect(() => {
    if (tenantId) {
      router.replace(`/${tenantId}/finanzas?tab=charges`);
    }
  }, [tenantId, router]);

  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-muted-foreground">Redireccionando a Cargos...</div>
    </div>
  );
}
