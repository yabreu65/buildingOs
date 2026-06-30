'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

interface Params {
  tenantId: string;
  [key: string]: string | string[];
}

export default function AliasTicketsPage() {
  const router = useRouter();
  const params = useParams<Params>();
  const tenantId = params?.tenantId;

  useEffect(() => {
    if (tenantId) {
      router.replace(`/${tenantId}/support`);
    }
  }, [tenantId, router]);

  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-muted-foreground">Redireccionando a Tickets...</div>
    </div>
  );
}
