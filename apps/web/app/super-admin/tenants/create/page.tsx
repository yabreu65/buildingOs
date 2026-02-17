'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import TenantCreateWizard from '@/features/super-admin/components/TenantCreateWizard';
import { createTenant } from '@/features/super-admin/tenants.storage';
import type { CreateTenantInput } from '@/features/super-admin/super-admin.types';

export default function CreateTenantPage() {
  const router = useRouter();
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(false);

  const onSubmit = async (data: CreateTenantInput) => {
    try {
      setIsLoading(true);
      const newTenant = createTenant(data);
      setFeedback({ type: 'success', message: `Tenant "${newTenant.name}" creado` });
      setTimeout(() => {
        router.push('/super-admin/tenants');
      }, 2000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al crear tenant';
      setFeedback({ type: 'error', message });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <TenantCreateWizard onSubmit={onSubmit} isLoading={isLoading} feedback={feedback} />
  );
}
