'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { BuildingBreadcrumb, BuildingSubnav } from '@/features/buildings/components';
import { useTicketsReport } from '@/features/reports/hooks/useTicketsReport';
import { useFinanceReport } from '@/features/reports/hooks/useFinanceReport';
import { useCommunicationsReport } from '@/features/reports/hooks/useCommunicationsReport';
import { useActivityReport } from '@/features/reports/hooks/useActivityReport';
import { ReportFilters } from '@/features/reports/components/ReportFilters';
import { TicketsReportComponent } from '@/features/reports/components/TicketsReport';
import { FinanceReportComponent } from '@/features/reports/components/FinanceReport';
import { CommunicationsReportComponent } from '@/features/reports/components/CommunicationsReport';
import { ActivityReportComponent } from '@/features/reports/components/ActivityReport';

type TabType = 'tickets' | 'finance' | 'communications' | 'activity';

interface BuildingParams {
  readonly tenantId: string;
  readonly buildingId: string;
  readonly [key: string]: string | string[];
}

interface ReportStateFilters {
  readonly from?: string;
  readonly to?: string;
  readonly period?: string;
}

export default function BuildingReportsPage() {
  const { tenantId, buildingId } = useParams<BuildingParams>();
  const tenantIdStr = typeof tenantId === 'string' ? tenantId : undefined;
  const buildingIdStr = typeof buildingId === 'string' ? buildingId : undefined;

  if (!tenantIdStr || !buildingIdStr) {
    return <div>Invalid parameters</div>;
  }

  const [activeTab, setActiveTab] = useState<TabType>('tickets');
  const [filters, setFilters] = useState<ReportStateFilters>({});

  // Lazy-load reports only when their tab is active
  const ticketsReport = useTicketsReport(
    activeTab === 'tickets' ? tenantIdStr : undefined,
    { buildingId: buildingIdStr, from: filters.from, to: filters.to }
  );

  const financeReport = useFinanceReport(
    activeTab === 'finance' ? tenantIdStr : undefined,
    { buildingId: buildingIdStr, period: filters.period }
  );

  const communicationsReport = useCommunicationsReport(
    activeTab === 'communications' ? tenantIdStr : undefined,
    { buildingId: buildingIdStr, from: filters.from, to: filters.to }
  );

  const activityReport = useActivityReport(
    activeTab === 'activity' ? tenantIdStr : undefined,
    { buildingId: buildingIdStr, from: filters.from, to: filters.to }
  );

  const tabs: Array<{ id: TabType; label: string }> = [
    { id: 'tickets', label: 'Tickets' },
    { id: 'finance', label: 'Finanzas' },
    { id: 'communications', label: 'Comunicados' },
    { id: 'activity', label: 'Actividad' },
  ];

  return (
    <div className="space-y-6">
      <BuildingBreadcrumb
        tenantId={tenantIdStr}
        buildingName="Reportes"
        buildingId={buildingIdStr}
      />

      <BuildingSubnav tenantId={tenantIdStr} buildingId={buildingIdStr} />

      <div className="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm md:p-6">
        <h2 className="text-2xl font-bold tracking-tight">Reportes del edificio</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Análisis operativo y financiero consolidado por período.
        </p>
      </div>

      {/* Filters (date range only, no building selector) */}
      <ReportFilters
        onApply={(newFilters) => {
          setFilters({
            from: newFilters.from,
            to: newFilters.to,
            period: newFilters.period,
          });
        }}
        hideBuildingSelector
      />

      {/* Tabs */}
      <div className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
        <div className="overflow-x-auto border-b border-border">
          <div className="flex min-w-max gap-1 p-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-4 md:p-6">
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
              buildingId={buildingIdStr}
              period={filters.period}
              tenantId={tenantIdStr}
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
