'use client';

import { useTenantId } from '@/features/tenancy/tenant.hooks';
import { OnboardingImportWizard } from '@/features/onboarding-import/OnboardingImportWizard';
import { EmptyState } from '@/shared/components/ui';
import { AlertCircle } from 'lucide-react';

export default function OnboardingImportSettingsPage() {
  const tenantId = useTenantId();

  if (!tenantId) {
    return (
      <EmptyState
        icon={<AlertCircle className="text-muted-foreground" size={32} />}
        title="Tenant not available"
        description="Open this page from a tenant-scoped route."
      />
    );
  }

  return <OnboardingImportWizard />;
}
