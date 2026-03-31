'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

export default function PaymentsReviewPage() {
  const router = useRouter();
  const params = useParams();
  const tenantId = params?.tenantId as string;

  useEffect(() => {
    if (tenantId) {
      router.replace(`/${tenantId}/finanzas?tab=pagos`);
    }
  }, [tenantId, router]);

  return null;
}
