'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useBuildings } from '@/features/buildings/hooks/useBuildings';
import { useTicketsReport } from '@/features/reports/hooks/useTicketsReport';
import { useFinanceReport } from '@/features/reports/hooks/useFinanceReport';
import { useCommunicationsReport } from '@/features/reports/hooks/useCommunicationsReport';
import { useActivityReport } from '@/features/reports/hooks/useActivityReport';
import { useSubscription } from '@/features/billing/hooks/useSubscription';
import { ReportFilters } from '@/features/reports/components/ReportFilters';
import { TicketsReportComponent } from '@/features/reports/components/TicketsReport';
import { FinanceReportComponent } from '@/features/reports/components/FinanceReport';
import { CommunicationsReportComponent } from '@/features/reports/components/CommunicationsReport';
import { ActivityReportComponent } from '@/features/reports/components/ActivityReport';
import FeatureGatedButton from '@/features/billing/components/FeatureGatedButton';
import { ErrorState } from '@/shared/components/ui';
import { Download } from 'lucide-react';

type TabType = 'tickets' | 'finance' | 'communications' | 'activity';

export default function ReportsPage() {
  const params = useParams();
  const tenantId = params.tenantId as string;

  const [activeTab, setActiveTab] = useState<TabType>('tickets');
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | undefined>();
  const [filters, setFilters] = useState<{
    buildingId?: string;
    from?: string;
    to?: string;
    period?: string;
  }>({});

  // Load subscription for feature gating
  const { features } = useSubscription();

  // Load buildings for selector
  const { buildings, loading: buildingsLoading, error: buildingsError } = useBuildings(tenantId);

  // Lazy-load reports only when their tab is active
  const ticketsReport = useTicketsReport(
    activeTab === 'tickets' ? tenantId : undefined,
    { buildingId: filters.buildingId, from: filters.from, to: filters.to }
  );

  const financeReport = useFinanceReport(
    activeTab === 'finance' ? tenantId : undefined,
    { buildingId: filters.buildingId, period: filters.period }
  );

  const communicationsReport = useCommunicationsReport(
    activeTab === 'communications' ? tenantId : undefined,
    { buildingId: filters.buildingId, from: filters.from, to: filters.to }
  );

  const activityReport = useActivityReport(
    activeTab === 'activity' ? tenantId : undefined,
    { buildingId: filters.buildingId, from: filters.from, to: filters.to }
  );

  if (buildingsError) {
    return <ErrorState message={buildingsError} />;
  }

  const tabs: Array<{ id: TabType; label: string }> = [
    { id: 'tickets', label: 'Tickets' },
    { id: 'finance', label: 'Finanzas' },
    { id: 'communications', label: 'Comunicados' },
    { id: 'activity', label: 'Actividad' },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header with Export Button */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">Reportes</h1>
          <p className="text-gray-600">Vista general de operaciones del edificio</p>
        </div>
        <FeatureGatedButton
          features={features}
          featureKey="canExportReports"
          requiredPlan="BASIC"
          onClick={() => {
            // TODO: Implement export functionality
            alert('Export feature coming soon');
          }}
        >
          <Download className="w-4 h-4 mr-2" />
          Exportar CSV
        </FeatureGatedButton>
      </div>

      {/* Filters */}
      <ReportFilters
        buildings={buildings}
        selectedBuildingId={selectedBuildingId}
        onBuildingChange={(buildingId) => {
          setSelectedBuildingId(buildingId);
          setFilters((f) => ({ ...f, buildingId }));
        }}
        onApply={(newFilters) => {
          setFilters(newFilters);
        }}
        loading={buildingsLoading}
      />

      {/* Tabs */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-200">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-6 py-3 font-medium text-sm transition-colors ${
                activeTab === tab.id
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'tickets' && (
            <TicketsReportComponent
              data={ticketsReport.data}
              loading={ticketsReport.loading}
              error={ticketsReport.error}
              onRetry={ticketsReport.refetch}
            />
          )}

          {activeTab === 'finance' && (
            <FinanceReportComponent
              data={financeReport.data}
              loading={financeReport.loading}
              error={financeReport.error}
              onRetry={financeReport.refetch}
            />
          )}

          {activeTab === 'communications' && (
            <CommunicationsReportComponent
              data={communicationsReport.data}
              loading={communicationsReport.loading}
              error={communicationsReport.error}
              onRetry={communicationsReport.refetch}
            />
          )}

          {activeTab === 'activity' && (
            <ActivityReportComponent
              data={activityReport.data}
              loading={activityReport.loading}
              error={activityReport.error}
              onRetry={activityReport.refetch}
            />
          )}
        </div>
      </div>
    </div>
  );
}
