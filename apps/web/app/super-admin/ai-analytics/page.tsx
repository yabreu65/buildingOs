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
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">
          AI Analytics Overview
        </h1>
        <p className="text-gray-600 mt-2">
          Monitor AI usage and costs across all tenants
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between mb-8 p-4 bg-gray-50 rounded-lg">
        <div>
          <label htmlFor="month" className="text-sm font-medium text-gray-700">
            Month
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Tenants List */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Tenants by Cost
            </h2>

            {loading && (
              <div className="text-gray-500 text-sm">Loading tenants...</div>
            )}

            {error && (
              <div className="text-red-600 text-sm">{error}</div>
            )}

            {tenants && tenants.length > 0 && (
              <div className="space-y-2">
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
              <div className="text-gray-500 text-sm text-center py-4">
                No tenants with AI usage
              </div>
            )}
          </div>
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-2">
          {selectedTenantId ? (
            <>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">
                  {detail?.tenantName || 'Tenant Details'}
                </h2>
                <button
                  onClick={() => setSelectedTenantId(null)}
                  className="text-xs text-gray-600 hover:text-gray-900"
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
            <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
              <p className="text-gray-500">
                Select a tenant to view detailed analytics
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
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded border-2 transition-all ${
        isSelected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="font-medium text-gray-900">{tenant.name}</div>
          <div className="text-xs text-gray-600">{tenant.calls} calls</div>
        </div>

        {/* Risk indicator */}
        {tenant.atRisk && (
          <div className="ml-2 px-2 py-1 rounded text-xs font-medium bg-orange-100 text-orange-700">
            ⚠ {tenant.percentUsed}%
          </div>
        )}
      </div>

      {/* Cost bar */}
      <div className="mt-2 w-full bg-gray-200 rounded h-1.5">
        <div
          className={`h-1.5 rounded ${
            tenant.atRisk ? 'bg-orange-500' : 'bg-green-500'
          }`}
          style={{
            width: `${Math.min(tenant.percentUsed, 100)}%`,
          }}
        />
      </div>

      <div className="mt-1 text-xs text-gray-600">
        ${(tenant.estimatedCostCents / 100).toFixed(2)} /{' '}
        ${(tenant.budgetCents / 100).toFixed(2)}
      </div>
    </button>
  );
}
