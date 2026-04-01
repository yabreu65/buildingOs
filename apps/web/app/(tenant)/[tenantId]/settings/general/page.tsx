'use client';

import { useState } from 'react';
import { useTenantId } from '@/features/tenancy/tenant.hooks';
import { useTenantBranding, updateTenantBranding } from '@/features/tenancy/hooks/useTenantBranding';
import Card from '@/shared/components/ui/Card';
import Button from '@/shared/components/ui/Button';
import { t } from '@/i18n';
import { useQueryClient } from '@tanstack/react-query';

const CURRENCIES = [
  { code: 'ARS', label: 'settings.currencyARS', flag: '🇦🇷' },
  { code: 'VES', label: 'settings.currencyVES', flag: '🇻🇪' },
  { code: 'USD', label: 'settings.currencyUSD', flag: '🇺🇸' },
];

export default function GeneralSettingsPage() {
  const tenantId = useTenantId()!;
  const queryClient = useQueryClient();
  const { branding, isLoading, currency } = useTenantBranding();

  const [selectedCurrency, setSelectedCurrency] = useState(currency);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleSaveCurrency = async () => {
    if (!selectedCurrency || selectedCurrency === currency) {
      return;
    }

    setIsSaving(true);
    try {
      await updateTenantBranding(tenantId, { currency: selectedCurrency });

      // Invalidate tenant branding query to refetch
      await queryClient.invalidateQueries({ queryKey: ['tenantBranding', tenantId] });

      setFeedback({
        type: 'success',
        message: t('settings.currencySaved')
      });

      setTimeout(() => setFeedback(null), 3000);
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : t('common.error')
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-4 bg-gray-200 rounded w-1/4" />
        <div className="h-10 bg-gray-200 rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">{t('settings.general')}</h1>
        <p className="text-sm text-muted-foreground">{t('settings.title')}</p>
      </div>

      <Card>
        <div className="p-6">
          <h2 className="text-lg font-semibold mb-4">{t('settings.currency')}</h2>

          <div className="space-y-3">
            {CURRENCIES.map((curr) => (
              <label
                key={curr.code}
                className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition"
              >
                <input
                  type="radio"
                  name="currency"
                  value={curr.code}
                  checked={selectedCurrency === curr.code}
                  onChange={(e) => setSelectedCurrency(e.target.value)}
                  className="w-4 h-4"
                />
                <span className="ml-3 text-lg">{curr.flag}</span>
                <span className="ml-2 font-medium">{t(curr.label)}</span>
              </label>
            ))}
          </div>

          {feedback && (
            <div
              className={`mt-4 p-3 rounded-lg text-sm ${
                feedback.type === 'success'
                  ? 'bg-green-50 text-green-700'
                  : 'bg-red-50 text-red-700'
              }`}
            >
              {feedback.message}
            </div>
          )}

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
}
