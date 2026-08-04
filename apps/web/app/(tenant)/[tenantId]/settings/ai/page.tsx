'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useActiveTenantId } from '@/features/auth/useAuthSession';
import { useCanAccessAi } from '@/features/auth/useUserRoles';
import { useAuthorizedPortalContext } from '@/features/auth/useAuthorizedPortalContext';
import { useTenantId } from '@/features/tenancy/tenant.hooks';
import { useAiAnalytics } from '@/features/assistant/hooks/useAiAnalytics';
import { useAiLimits } from '@/features/assistant/hooks/useAiLimits';
import { useAiNudges } from '@/features/assistant/hooks/useAiNudges';
import { AiAnalyticsPanel } from '@/features/assistant/components/analytics/AiAnalyticsPanel';
import { AiPlanLimitsCard } from '@/features/assistant/components/limits/AiPlanLimitsCard';
import { AiLimitBanner } from '@/features/assistant/components/limits/AiLimitBanner';
import { AiNudgesPanel } from '@/features/assistant/components/limits/AiNudgesPanel';
import { routes } from '@/shared/lib/routes';

/**
 * Phase 13: Tenant AI Settings Page
 * Display plan limits, usage, warnings, and analytics
 */
function TenantAiAnalyticsContent({ tenantId }: { tenantId: string }) {
  const { analytics, loading, error, month, setMonth, refetch } =
    useAiAnalytics(tenantId);

  const { limits, usage, loading: limitsLoading, error: limitsError } =
    useAiLimits(tenantId);
  const {
    nudges,
    loading: nudgesLoading,
    submitting: nudgesSubmitting,
    error: nudgesError,
    dismiss,
    requestUpgrade,
  } = useAiNudges(tenantId);

  // Determine if we should show warning/blocked banners
  const budgetPercent = limits.budgetCents === 0 ? 0 : (usage.estimatedCostCents / limits.budgetCents) * 100;
  const callsPercent = usage.callsPercent;

  const showBudgetWarning = limits.budgetCents > 0 && budgetPercent >= 80 && budgetPercent < 100;
  const showBudgetBlocked = limits.budgetCents > 0 && budgetPercent >= 100;
  const showCallsWarning = limits.callsLimit > 0 && limits.callsLimit < 9999 && callsPercent >= 80 && callsPercent < 100;
  const showCallsBlocked = limits.callsLimit > 0 && limits.callsLimit < 9999 && callsPercent >= 100;

  const upgradeUrl = `/${tenantId}/settings/billing`;
  const limitsErrorMessage = limitsError;

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">AI Assistant</h1>
        <p className="text-gray-600 mt-2">
          Manage your AI plan, limits, and view usage analytics
        </p>
      </div>

      {/* Plan Limits Card */}
      {!limitsLoading && (
        <div className="mb-8">
          <AiPlanLimitsCard
            planName="Plan actual"
            limits={limits}
            usage={usage}
          />
        </div>
      )}

      {/* Upgrade Nudges */}
      <div className="mb-8">
        <AiNudgesPanel
          nudges={nudges}
          loading={nudgesLoading}
          submitting={nudgesSubmitting}
          onDismiss={dismiss}
          onRequestUpgrade={requestUpgrade}
        />
      </div>

      {limitsErrorMessage ? (
        <div
          className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          role="alert"
        >
          {limitsErrorMessage}
        </div>
      ) : null}

      {nudgesError ? (
        <div
          className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          role="alert"
        >
          {nudgesError}
        </div>
      ) : null}

      {/* Warning Banners */}
      <div className="space-y-4 mb-8">
        {showBudgetWarning && (
          <AiLimitBanner
            type="budget_warning"
            percentUsed={budgetPercent}
            upgradeHref={upgradeUrl}
          />
        )}
        {showBudgetBlocked && (
          <AiLimitBanner
            type="budget_blocked"
            percentUsed={budgetPercent}
            upgradeHref={upgradeUrl}
          />
        )}
        {showCallsWarning && (
          <AiLimitBanner
            type="calls_warning"
            percentUsed={callsPercent}
            upgradeHref={upgradeUrl}
          />
        )}
        {showCallsBlocked && (
          <AiLimitBanner
            type="calls_blocked"
            percentUsed={callsPercent}
            upgradeHref={upgradeUrl}
          />
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between mb-8 p-4 bg-gray-50 rounded-lg">
        <div>
          <label htmlFor="month" className="text-sm font-medium text-gray-700">
            Analytics Month
          </label>
          <input
            id="month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="mt-1 px-3 py-2 border border-gray-300 rounded text-sm"
          />
        </div>
        <button
          onClick={refetch}
          className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700"
        >
          Refresh
        </button>
      </div>

      {/* Analytics Panel */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Usage Analytics</h2>
        <AiAnalyticsPanel
          analytics={analytics}
          loading={loading}
          error={error}
        />
      </div>
    </div>
  );
}

export function TenantAiAnalyticsPage() {
  const router = useRouter();
  const routeTenantId = useTenantId();
  const activeTenantId = useActiveTenantId();
  const portalContext = useAuthorizedPortalContext(routeTenantId);
  const canAccessAi = useCanAccessAi();

  const hasMatchingTenant =
    activeTenantId !== null &&
    routeTenantId !== null &&
    activeTenantId === routeTenantId;
  const tenantId = hasMatchingTenant ? activeTenantId : null;

  useEffect(() => {
    if (activeTenantId && routeTenantId && activeTenantId !== routeTenantId) {
      router.replace(`/${activeTenantId}/settings/ai`);
      return;
    }

    if (portalContext === 'resident' && tenantId) {
      router.replace(routes.residentDashboard(tenantId));
    }
  }, [activeTenantId, portalContext, routeTenantId, router, tenantId]);

  if (!tenantId || portalContext !== 'admin') {
    return <div className="min-h-[240px]" aria-busy="true" />;
  }

  if (!canAccessAi) {
    return (
      <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 p-6 text-sm text-muted-foreground">
        No tenés permiso para acceder a las métricas de IA del tenant.
      </div>
    );
  }

  return <TenantAiAnalyticsContent key={tenantId} tenantId={tenantId} />;
}

export default TenantAiAnalyticsPage;
