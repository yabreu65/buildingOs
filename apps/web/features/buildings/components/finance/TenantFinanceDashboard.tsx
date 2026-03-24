'use client';

import { useState } from 'react';
import Card from '@/shared/components/ui/Card';
import Button from '@/shared/components/ui/Button';
import { FinanceSummaryCards } from './FinanceSummaryCards';
import { BuildingsFinanceSummary } from './BuildingsFinanceSummary';
import { TenantDelinquentUnitsList } from './TenantDelinquentUnitsList';
import { useTenantFinanceSummary } from '../../hooks/useTenantFinanceSummary';
import { cn } from '@/shared/lib/utils';

type Tab = 'overview' | 'delinquent';

export const TenantFinanceDashboard = () => {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [period, setPeriod] = useState<string>('');

  const { summary, loading, error, refetch } = useTenantFinanceSummary(period);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Finanzas del Tenant</h1>
        <p className="text-muted-foreground">Resumen agregado de todos los edificios</p>
      </div>

      {/* KPI Cards */}
      <FinanceSummaryCards summary={summary} loading={loading} error={error} onRetry={refetch} />

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
          <Card>
            <div className="p-6 text-center text-gray-500">
              Cargando resumen de edificios...
            </div>
          </Card>
        )}

        {activeTab === 'delinquent' && (
          <TenantDelinquentUnitsList delinquent={summary?.topDelinquentUnits || []} loading={loading} />
        )}
      </div>
    </div>
  );
};
