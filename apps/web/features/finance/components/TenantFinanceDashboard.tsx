'use client';

import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Card from '@/shared/components/ui/Card';
import Button from '@/shared/components/ui/Button';
import { FinanceSummaryCards } from './FinanceSummaryCards';
import { BuildingsFinanceSummary } from './BuildingsFinanceSummary';
import { TenantDelinquentUnitsList } from './TenantDelinquentUnitsList';
import { useTenantFinanceSummary } from '../hooks/useTenantFinanceSummary';
import { useBuildings } from '@/features/buildings/hooks';
import { Skeleton } from '@/shared/components/ui';
import { cn } from '@/shared/lib/utils';

type Tab = 'overview' | 'delinquent';

interface Params {
  tenantId: string;
  [key: string]: string | string[];
}

/**
 * Dashboard component for tenant-level finance overview.
 * Displays aggregated financial data across all buildings with tabs for overview and delinquent units.
 * @returns Dashboard with summary cards, buildings overview, and delinquent units list
 */
export const TenantFinanceDashboard = () => {
  const params = useParams<Params>();
  const tenantId = params?.tenantId;
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [period, setPeriod] = useState<string>('');

  const { data: summary, isPending: loading, error, refetch } = useTenantFinanceSummary(period);
  const { buildings, loading: buildingsLoading } = useBuildings(tenantId);

  const buildingIds = useMemo(() => buildings.map((b) => b.id), [buildings]);
  const buildingNames = useMemo(
    () => buildings.reduce((acc, b) => ({ ...acc, [b.id]: b.name }), {} as Record<string, string>),
    [buildings]
  );

  // Convert React Query error to string message
  const errorMsg = error ? (error instanceof Error ? error.message : String(error)) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Finanzas del Tenant</h1>
        <p className="text-muted-foreground">Resumen agregado de todos los edificios</p>
      </div>

      {/* KPI Cards */}
      <FinanceSummaryCards summary={summary} loading={loading} error={errorMsg} onRetry={refetch} />

      {/* Tabs */}
      <div className="space-y-4">
        <div className="border-b">
          <nav className="flex gap-1">
            {[
              { id: 'overview', label: 'Resumen' },
              { id: 'delinquent', label: `Unidades Morosas (${summary?.delinquentUnitsCount || 0})` },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as Tab)}
                className={cn(
                  'px-4 py-2 border-b-2 transition -mb-px text-sm font-medium',
                  activeTab === tab.id
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          buildingsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : buildingIds.length === 0 ? (
            <Card>
              <div className="p-6 text-center text-gray-600">
                <p className="text-sm">No hay edificios disponibles</p>
                <p className="text-xs text-muted-foreground mt-2">Crea un edificio para ver el resumen financiero</p>
              </div>
            </Card>
          ) : (
            <BuildingsFinanceSummary
              tenantId={tenantId || ''}
              buildingIds={buildingIds}
              buildingNames={buildingNames}
            />
          )
        )}

        {activeTab === 'delinquent' && (
          <TenantDelinquentUnitsList delinquent={summary?.topDelinquentUnits || []} loading={loading} />
        )}
      </div>
    </div>
  );
};
