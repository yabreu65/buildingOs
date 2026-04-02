'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/shared/components/ui';
import { AlertCircle } from 'lucide-react';
import { apiClient } from '@/shared/lib/http/client';
import { LiquidationDraftCard } from '../components/LiquidationDraftCard';
import CreateLiquidationModal from '../components/CreateLiquidationModal';

interface LiquidationsPageProps {
  tenantId: string;
}

const statusTabs = [
  { value: 'DRAFT', label: 'Borradores' },
  { value: 'REVIEWED', label: 'Revisadas' },
  { value: 'PUBLISHED', label: 'Publicadas' },
  { value: 'CANCELED', label: 'Canceladas' },
] as const;

export default function LiquidationsPage({ tenantId }: LiquidationsPageProps) {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [activeTab, setActiveTab] = useState('DRAFT');

  // Fetch buildings
  const buildingsQuery = useQuery({
    queryKey: ['buildings', tenantId],
    queryFn: async () => {
      return apiClient({
        path: `/tenants/${tenantId}/buildings`,
        headers: { 'tenant-id': tenantId },
      });
    },
  });

  // Fetch liquidations
  const liquidationsQuery = useQuery({
    queryKey: ['liquidations', tenantId, refreshTrigger],
    queryFn: async () => {
      return apiClient({
        path: `/tenants/${tenantId}/liquidations`,
        headers: { 'tenant-id': tenantId },
      });
    },
  });

  const handleRefresh = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  const buildings = (buildingsQuery.data as any) || [];
  const liquidations = (liquidationsQuery.data as any) || [];

  // Group liquidations by status
  const groupedLiquidations = statusTabs.reduce(
    (acc, tab) => {
      acc[tab.value] = liquidations.filter((l: any) => l.status === tab.value);
      return acc;
    },
    {} as Record<string, any[]>,
  );

  const activeTabData = groupedLiquidations[activeTab as keyof typeof groupedLiquidations] || [];

  return (
    <div className="max-w-6xl mx-auto p-4">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold">Liquidaciones</h1>
          {!buildingsQuery.isLoading && (
            <CreateLiquidationModal
              tenantId={tenantId}
              buildings={buildings}
              onSuccess={handleRefresh}
            />
          )}
        </div>
        <p className="text-gray-600">Crea y gestiona las liquidaciones de expensas por período</p>
      </div>

      {/* Error State */}
      {liquidationsQuery.isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <div>
            <p className="font-medium text-red-900">Error al cargar liquidaciones</p>
            <p className="text-sm text-red-700">Por favor, intente nuevamente</p>
          </div>
        </div>
      )}

      {/* Loading State */}
      {(liquidationsQuery.isLoading || buildingsQuery.isLoading) && (
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {/* Empty State */}
      {!liquidationsQuery.isLoading && !buildingsQuery.isLoading && liquidations.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-8 text-center">
          <AlertCircle className="w-8 h-8 text-blue-600 mx-auto mb-2" />
          <p className="font-medium text-blue-900">No hay liquidaciones aún</p>
          <p className="text-sm text-blue-700">Crea una nueva para comenzar</p>
        </div>
      )}

      {/* Content */}
      {!liquidationsQuery.isLoading && !buildingsQuery.isLoading && liquidations.length > 0 && (
        <div>
          {/* Tabs */}
          <div className="flex gap-2 mb-6 border-b overflow-x-auto">
            {statusTabs.map((tab) => {
              const count = groupedLiquidations[tab.value].length;
              const isActive = activeTab === tab.value;
              return (
                <button
                  key={tab.value}
                  onClick={() => setActiveTab(tab.value)}
                  className={`px-4 py-3 font-medium text-sm whitespace-nowrap border-b-2 transition-colors ${
                    isActive
                      ? 'border-primary text-primary'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {tab.label} ({count})
                </button>
              );
            })}
          </div>

          {/* Tab Content */}
          <div className="space-y-4">
            {activeTabData.length === 0 ? (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
                <p className="text-gray-600">No hay liquidaciones en estado {statusTabs.find(t => t.value === activeTab)?.label.toLowerCase()}</p>
              </div>
            ) : (
              activeTabData.map((liq: any) => (
                <LiquidationDraftCard
                  key={liq.id}
                  tenantId={tenantId}
                  liquidation={liq}
                  expenses={liq.expenses || []}
                  chargesPreview={liq.chargesPreview || []}
                  onRefresh={handleRefresh}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
