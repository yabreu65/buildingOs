'use client';

import { TenantAnalyticsResponse } from '../../services/analytics.api';
import { AiUsageBar } from './AiUsageBar';
import { AiEfficiencyStats } from './AiEfficiencyStats';
import { AiTopList } from './AiTopList';

interface AiAnalyticsPanelProps {
  analytics: TenantAnalyticsResponse | null;
  loading: boolean;
  error: string | null;
}

/**
 * Complete Analytics Panel for Tenant
 * Displays usage, efficiency, adoption, templates, and actions
 */
export function AiAnalyticsPanel({
  analytics,
  loading,
  error,
}: AiAnalyticsPanelProps) {
  if (loading) {
    return (
      <div className="space-y-6">
        {/* Skeleton loading */}
        <div className="h-20 bg-gray-200 rounded animate-pulse" />
        <div className="h-40 bg-gray-200 rounded animate-pulse" />
        <div className="h-64 bg-gray-200 rounded animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded text-red-700">
        <p className="font-semibold">Error loading analytics</p>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="text-center py-12 text-gray-500">
        No analytics data available
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Usage Section */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">
          Usage & Budget
        </h2>
        <div className="space-y-4">
          <AiUsageBar
            estimatedCostCents={analytics.usage.estimatedCostCents}
            budgetCents={analytics.usage.budgetCents}
            percentUsed={analytics.usage.percentUsed}
          />
          <div className="pt-4 border-t grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-gray-900">
                {analytics.usage.calls}
              </div>
              <div className="text-xs text-gray-600">Total Calls</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">
                ${(analytics.usage.estimatedCostCents / 100).toFixed(2)}
              </div>
              <div className="text-xs text-gray-600">Estimated Cost</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">
                ${(analytics.usage.budgetCents / 100).toFixed(2)}
              </div>
              <div className="text-xs text-gray-600">Monthly Budget</div>
            </div>
          </div>
        </div>
      </section>

      {/* Efficiency Section */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">
          Efficiency Metrics
        </h2>
        <AiEfficiencyStats
          cacheHitRate={analytics.efficiency.cacheHitRate}
          totalInteractions={analytics.efficiency.totalInteractions}
          cacheHits={analytics.efficiency.cacheHits}
          smallCalls={analytics.efficiency.smallCalls}
          bigCalls={analytics.efficiency.bigCalls}
          mockCalls={analytics.efficiency.mockCalls}
        />
      </section>

      {/* Adoption Section */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">
          Adoption
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <div className="text-3xl font-bold text-gray-900">
              {analytics.adoption.uniqueUsers}
            </div>
            <div className="text-sm text-gray-600">Unique Users</div>
          </div>
          <AiTopList
            title="Popular Pages"
            items={analytics.adoption.interactionsByPage.map((item) => ({
              label: item.page,
              count: item.count,
            }))}
          />
        </div>
      </section>

      {/* Templates Section */}
      {analytics.templates.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <AiTopList
            title="Top Templates Used"
            items={analytics.templates.map((t) => ({
              label: t.templateKey,
              count: t.runs,
            }))}
          />
        </section>
      )}

      {/* Actions Section */}
      {analytics.actions.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <AiTopList
            title="Top Actions Taken"
            items={analytics.actions.map((a) => ({
              label: a.actionType,
              count: a.clicks,
            }))}
          />
        </section>
      )}
    </div>
  );
}
