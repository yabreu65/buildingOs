'use client';

import { useParams } from 'next/navigation';
import { useAiAnalytics } from '@/features/assistant/hooks/useAiAnalytics';
import { AiAnalyticsPanel } from '@/features/assistant/components/analytics/AiAnalyticsPanel';

/**
 * Tenant AI Analytics Page
 * Display AI usage, efficiency, and adoption metrics for current month
 */
export default function TenantAiAnalyticsPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;

  const { analytics, loading, error, month, setMonth, refetch } =
    useAiAnalytics(tenantId);

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">AI Analytics</h1>
        <p className="text-gray-600 mt-2">
          Track your AI Assistant usage, costs, and efficiency metrics
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

      {/* Analytics Panel */}
      <AiAnalyticsPanel
        analytics={analytics}
        loading={loading}
        error={error}
      />
    </div>
  );
}
