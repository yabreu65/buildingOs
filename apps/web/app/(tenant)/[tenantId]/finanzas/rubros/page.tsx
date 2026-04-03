'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

interface Params {
  tenantId: string;
  [key: string]: string | string[];
}

/**
 * Alias route: /:tenantId/finanzas/rubros
 * Redirects to canonical: /:tenantId/finance/categories
 */
export default function AliasRubrosPage() {
  const router = useRouter();
  const params = useParams<Params>();
  const tenantId = params?.tenantId;

  useEffect(() => {
    if (tenantId) {
      router.replace(`/${tenantId}/finance/categories`);
    }
  }, [tenantId, router]);

  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-muted-foreground">Redireccionando a Rubros...</div>
    </div>
  );
}
