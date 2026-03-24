'use client';

import { useSuperAdminAiAnalytics } from '@/features/assistant/hooks/useSuperAdminAiAnalytics';
import { AiAnalyticsPanel } from '@/features/assistant/components/analytics/AiAnalyticsPanel';
import { TenantSummaryItem } from '@/features/assistant/services/analytics.api';

/**
 * Super-Admin AI Analytics Dashboard
 * View AI usage across all tenants, sorted by cost
 */
export default function SuperAdminAiAnalyticsPage() {
  const {
    tenants,
    loading,
    error,
    month,
    setMonth,
    selectedTenantId,
    setSelectedTenantId,
    detail,
    detailLoading,
    detailError,
    refetch,
  } = useSuperAdminAiAnalytics();

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
          AI Analytics
        </h1>
        <p className="text-muted-foreground mt-2 text-lg">
          Monitor AI usage and costs across all tenants
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between p-6 bg-gradient-to-r from-card to-muted/50 rounded-xl border border-border shadow-sm">
        <div>
          <label htmlFor="month" className="text-sm font-semibold text-foreground">
            Select Month
          </label>
          <input
            id="month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="mt-2 px-4 py-2 border border-border rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <button
          onClick={refetch}
          className="px-6 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg text-sm font-semibold hover:from-blue-700 hover:to-blue-800 transition-all shadow-md hover:shadow-lg"
        >
          ↻ Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tenants List */}
        <div className="lg:col-span-1">
          <div className="bg-card rounded-xl border border-border p-6 shadow-sm">
            <h2 className="text-xl font-bold text-foreground mb-6">
              💰 Tenants by Cost
            </h2>

            {loading && (
              <div className="text-muted-foreground text-sm text-center py-8">⏳ Loading tenants...</div>
            )}

            {error && (
              <div className="bg-destructive/10 text-destructive text-sm p-4 rounded-lg">{error}</div>
            )}

            {tenants && tenants.length > 0 && (
              <div className="space-y-3">
                {tenants.map((tenant) => (
                  <TenantListItem
                    key={tenant.tenantId}
                    tenant={tenant}
                    isSelected={selectedTenantId === tenant.tenantId}
                    onClick={() => setSelectedTenantId(tenant.tenantId)}
                  />
                ))}
              </div>
            )}

            {tenants && tenants.length === 0 && (
              <div className="text-muted-foreground text-sm text-center py-8">
                📊 No tenants with AI usage
              </div>
            )}
          </div>
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-2">
          {selectedTenantId ? (
            <>
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-2xl font-bold text-foreground">
                  📊 {detail?.tenantName || 'Tenant Details'}
                </h2>
                <button
                  onClick={() => setSelectedTenantId(null)}
                  className="text-sm px-4 py-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                >
                  ✕ Close
                </button>
              </div>
              <AiAnalyticsPanel
                analytics={detail}
                loading={detailLoading}
                error={detailError}
              />
            </>
          ) : (
            <div className="bg-gradient-to-br from-muted/30 to-muted/50 rounded-xl border border-border p-16 text-center">
              <p className="text-muted-foreground text-lg">
                👈 Select a tenant to view detailed analytics
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Tenant list item with status indicator
 */
function TenantListItem({
  tenant,
  isSelected,
  onClick,
}: {
  tenant: TenantSummaryItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  const percentage = Math.min(tenant.percentUsed, 100);
  const isNearLimit = percentage > 80;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-lg border-2 transition-all duration-200 ${
        isSelected
          ? 'border-primary bg-primary/5 shadow-md'
          : 'border-border bg-card hover:border-primary/50 hover:shadow-md'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex-1">
          <div className="font-semibold text-foreground text-sm">{tenant.name}</div>
          <div className="text-xs text-muted-foreground mt-1">📞 {tenant.calls} calls</div>
        </div>

        {/* Risk indicator */}
        {tenant.atRisk && (
          <div className="ml-3 px-3 py-1 rounded-full text-xs font-bold bg-gradient-to-r from-orange-400 to-red-500 text-white">
            ⚠ {tenant.percentUsed}%
          </div>
        )}
      </div>

      {/* Cost bar */}
      <div className="mt-3 w-full bg-muted rounded-full h-2 overflow-hidden">
        <div
          className={`h-2 rounded-full transition-all duration-500 ${
            isNearLimit
              ? 'bg-gradient-to-r from-orange-500 to-red-500'
              : 'bg-gradient-to-r from-green-500 to-cyan-500'
          }`}
          style={{
            width: `${percentage}%`,
          }}
        />
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        <div className="text-muted-foreground">
          💵 ${(tenant.estimatedCostCents / 100).toFixed(2)}
        </div>
        <div className="font-semibold text-foreground">
          / ${(tenant.budgetCents / 100).toFixed(2)}
        </div>
      </div>
    </button>
  );
}
