'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useActiveTenantId } from '@/features/auth/useAuthSession';
import { useAuthorizedPortalContext } from '@/features/auth/useAuthorizedPortalContext';
import { useTenantId } from '@/features/tenancy/tenant.hooks';
import { useTenantBranding, updateTenantBranding } from '@/features/tenancy/hooks/useTenantBranding';
import { useCanAdministerTenant } from '@/features/tenancy/hooks/useEffectiveRole';
import Card from '@/shared/components/ui/Card';
import Button from '@/shared/components/ui/Button';
import { routes } from '@/shared/lib/routes';
import { t } from '@/i18n';
import { useQueryClient } from '@tanstack/react-query';

const CURRENCIES = [
  { code: 'ARS', label: 'settings.currencyARS', flag: '🇦🇷' },
  { code: 'VES', label: 'settings.currencyVES', flag: '🇻🇪' },
  { code: 'USD', label: 'settings.currencyUSD', flag: '🇺🇸' },
];

interface GeneralSettingsContentProps {
  tenantId: string;
}

const GeneralSettingsContent = ({ tenantId }: GeneralSettingsContentProps) => {
  const queryClient = useQueryClient();
  const { branding, isLoading, error, currency } = useTenantBranding(tenantId);

  const [selectedCurrency, setSelectedCurrency] = useState(currency);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    setSelectedCurrency(currency);
  }, [currency]);

  const handleSaveCurrency = async () => {
    if (!selectedCurrency || selectedCurrency === currency) {
      return;
    }

    setIsSaving(true);
    try {
      await updateTenantBranding(tenantId, { currency: selectedCurrency });

      await queryClient.invalidateQueries({ queryKey: ['tenantBranding', tenantId] });

      setFeedback({
        type: 'success',
        message: t('settings.currencySaved'),
      });

      window.setTimeout(() => setFeedback(null), 3000);
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : t('common.error'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-4 w-1/4 rounded bg-gray-200" />
        <div className="h-10 rounded bg-gray-200" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        role="alert"
      >
        {error instanceof Error ? error.message : t('common.error')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-2 text-2xl font-bold">{t('settings.general')}</h1>
        <p className="text-sm text-muted-foreground">{t('settings.title')}</p>
      </div>

      <Card>
        <div className="p-6">
          <h2 className="mb-4 text-lg font-semibold">{t('settings.currency')}</h2>

          {branding?.brandName ? (
            <p className="mb-4 text-sm text-muted-foreground">
              {branding.brandName}
            </p>
          ) : null}

          <div className="space-y-3">
            {CURRENCIES.map((curr) => (
              <label
                key={curr.code}
                className="flex cursor-pointer items-center rounded-lg border p-3 transition hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="currency"
                  value={curr.code}
                  checked={selectedCurrency === curr.code}
                  onChange={(event) => setSelectedCurrency(event.target.value)}
                  className="h-4 w-4"
                />
                <span className="ml-3 text-lg">{curr.flag}</span>
                <span className="ml-2 font-medium">{t(curr.label)}</span>
              </label>
            ))}
          </div>

          {feedback ? (
            <div
              className={`mt-4 rounded-lg p-3 text-sm ${
                feedback.type === 'success'
                  ? 'bg-green-50 text-green-700'
                  : 'bg-red-50 text-red-700'
              }`}
            >
              {feedback.message}
            </div>
          ) : null}

          <div className="mt-6 flex gap-2">
            <Button
              onClick={handleSaveCurrency}
              disabled={isSaving || selectedCurrency === currency}
              variant={selectedCurrency !== currency ? 'primary' : 'secondary'}
            >
              {isSaving ? t('forms.submitting') : t('common.save')}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

export const GeneralSettingsPage = () => {
  const routeTenantId = useTenantId();
  const router = useRouter();
  const activeTenantId = useActiveTenantId();
  const portalContext = useAuthorizedPortalContext(routeTenantId);
  const hasMatchingTenant =
    activeTenantId !== null &&
    routeTenantId !== null &&
    activeTenantId === routeTenantId;
  const tenantId = hasMatchingTenant ? activeTenantId : null;
  const canEditBranding = useCanAdministerTenant(tenantId ?? undefined);

  useEffect(() => {
    if (activeTenantId && routeTenantId && activeTenantId !== routeTenantId) {
      router.replace(`/${activeTenantId}/settings/general`);
      return;
    }

    if (portalContext === 'resident' && tenantId) {
      router.replace(routes.residentDashboard(tenantId));
    }
  }, [activeTenantId, portalContext, routeTenantId, router, tenantId]);

  if (!tenantId || portalContext !== 'admin') {
    return <div className="min-h-[240px]" aria-busy="true" />;
  }

  if (!canEditBranding) {
    return (
      <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 p-6 text-sm text-muted-foreground">
        No tenés permiso para editar el branding del tenant.
      </div>
    );
  }

  return <GeneralSettingsContent key={tenantId} tenantId={tenantId} />;
};

const Page = () => {
  return <GeneralSettingsPage />;
};

export default Page;
