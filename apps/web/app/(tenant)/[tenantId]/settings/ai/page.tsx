'use client';

import { useParams } from 'next/navigation';
import { useAiAnalytics } from '@/features/assistant/hooks/useAiAnalytics';
import { useAiLimits } from '@/features/assistant/hooks/useAiLimits';
import { AiAnalyticsPanel } from '@/features/assistant/components/analytics/AiAnalyticsPanel';
import { AiPlanLimitsCard } from '@/features/assistant/components/limits/AiPlanLimitsCard';
import { AiLimitBanner } from '@/features/assistant/components/limits/AiLimitBanner';

/**
 * Phase 13: Tenant AI Settings Page
 * Display plan limits, usage, warnings, and analytics
 */
export default function TenantAiAnalyticsPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;

  const { analytics, loading, error, month, setMonth, refetch } =
    useAiAnalytics(tenantId);

  const { limits, usage, loading: limitsLoading, error: limitsError } =
    useAiLimits(tenantId);

  // Determine if we should show warning/blocked banners
  const budgetPercent = limits.budgetCents === 0 ? 0 : (usage.estimatedCostCents / limits.budgetCents) * 100;
  const callsPercent = usage.callsPercent;

  const showBudgetWarning = limits.budgetCents > 0 && budgetPercent >= 80 && budgetPercent < 100;
  const showBudgetBlocked = limits.budgetCents > 0 && budgetPercent >= 100;
  const showCallsWarning = limits.callsLimit > 0 && limits.callsLimit < 9999 && callsPercent >= 80 && callsPercent < 100;
  const showCallsBlocked = limits.callsLimit > 0 && limits.callsLimit < 9999 && callsPercent >= 100;

  const upgradeUrl = `/${tenantId}/settings/billing`;

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
            planName="Current Plan"
            limits={limits}
            usage={usage}
          />
        </div>
      )}

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
