'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import TenantCreateWizard from '@/features/super-admin/components/TenantCreateWizard';
import { createTenant } from '@/features/super-admin/tenants.api';
import type { CreateTenantInput } from '@/features/super-admin/super-admin.validation';

export default function CreateTenantPage() {
  const router = useRouter();
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(false);

  const onSubmit = async (data: CreateTenantInput) => {
    try {
      setIsLoading(true);
      const newTenant = await createTenant({ ...data, planId: data.plan });
      router.push(`/super-admin/tenants/${newTenant.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo crear la administradora';
      setFeedback({ type: 'error', message });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <TenantCreateWizard onSubmit={onSubmit} isLoading={isLoading} feedback={feedback} />
  );
}
