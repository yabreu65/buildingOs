'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/shared/components/ui';
import { AlertCircle } from 'lucide-react';
import { apiClient } from '@/shared/lib/http/client';
import type { Liquidation } from '../services/expense-ledger.api';
import { LiquidationDraftCard } from '../components/LiquidationDraftCard';
import { CreateLiquidationModal } from '../components/CreateLiquidationModal';

interface BuildingSummary {
  readonly id: string;
  readonly name: string;
}

interface LiquidationExpenseItem {
  readonly id: string;
  readonly categoryName: string;
  readonly amountMinor: number;
  readonly currencyCode: string;
  readonly invoiceDate: string;
  readonly description: string | null;
  readonly vendorName: string | null;
}

interface LiquidationChargePreviewItem {
  readonly unitId: string;
  readonly unitCode: string;
  readonly unitLabel: string | null;
  readonly amountMinor: number;
}

interface LiquidationsListItem extends Liquidation {
  readonly expenses?: readonly LiquidationExpenseItem[];
  readonly chargesPreview?: readonly LiquidationChargePreviewItem[];
}

interface LiquidationsPageProps {
  readonly tenantId: string;
}

const statusTabs = [
  { value: 'DRAFT', label: 'Borradores' },
  { value: 'REVIEWED', label: 'Revisadas' },
  { value: 'PUBLISHED', label: 'Publicadas' },
  { value: 'CANCELED', label: 'Canceladas' },
] as const;

type LiquidationStatus = (typeof statusTabs)[number]['value'];
const liquidationStatuses = ['DRAFT', 'REVIEWED', 'PUBLISHED', 'CANCELED'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isLiquidationStatus(value: unknown): value is LiquidationStatus {
  return isString(value) && liquidationStatuses.some((status) => status === value);
}

function isBuildingSummary(value: unknown): value is BuildingSummary {
  return isRecord(value) && isString(value.id) && isString(value.name);
}

function parseBuildingSummaries(data: unknown): BuildingSummary[] {
  if (!Array.isArray(data)) {
    throw new Error('Respuesta inválida al cargar edificios');
  }

  const result: BuildingSummary[] = [];
  for (const item of data) {
    if (!isBuildingSummary(item)) {
      throw new Error('Respuesta inválida al cargar edificios');
    }
    result.push(item);
  }

  return result;
}

function isLiquidationExpenseItem(value: unknown): value is LiquidationExpenseItem {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.categoryName) &&
    isNumber(value.amountMinor) &&
    isString(value.currencyCode) &&
    isString(value.invoiceDate) &&
    (value.description === null || isString(value.description)) &&
    (value.vendorName === null || isString(value.vendorName))
  );
}

function isLiquidationChargePreviewItem(value: unknown): value is LiquidationChargePreviewItem {
  return (
    isRecord(value) &&
    isString(value.unitId) &&
    isString(value.unitCode) &&
    (value.unitLabel === null || isString(value.unitLabel)) &&
    isNumber(value.amountMinor)
  );
}

function isLiquidationsListItem(value: unknown): value is LiquidationsListItem {
  if (
    !isRecord(value) ||
    !isString(value.id) ||
    !isString(value.buildingId) ||
    !isString(value.period) ||
    !isLiquidationStatus(value.status) ||
    !isString(value.baseCurrency) ||
    !isNumber(value.totalAmountMinor) ||
    !isNumber(value.unitCount) ||
    !isString(value.generatedAt)
  ) {
    return false;
  }

  if (
    value.expenses !== undefined &&
    (!Array.isArray(value.expenses) || !value.expenses.every(isLiquidationExpenseItem))
  ) {
    return false;
  }

  if (
    value.chargesPreview !== undefined &&
    (!Array.isArray(value.chargesPreview) || !value.chargesPreview.every(isLiquidationChargePreviewItem))
  ) {
    return false;
  }

  return true;
}

function parseLiquidationsListItems(data: unknown): LiquidationsListItem[] {
  if (!Array.isArray(data)) {
    throw new Error('Respuesta inválida al cargar liquidaciones');
  }

  const result: LiquidationsListItem[] = [];
  for (const item of data) {
    if (!isLiquidationsListItem(item)) {
      throw new Error('Respuesta inválida al cargar liquidaciones');
    }
    result.push(item);
  }

  return result;
}

export function LiquidationsPage({ tenantId }: LiquidationsPageProps) {
  const normalizedTenantId = tenantId.trim();
  const hasValidTenantId = normalizedTenantId.length > 0;

  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [activeTab, setActiveTab] = useState<LiquidationStatus>('DRAFT');

  const buildingsQuery = useQuery({
    queryKey: ['buildings', normalizedTenantId],
    enabled: hasValidTenantId,
    queryFn: async () => {
      const data = await apiClient<unknown>({
        path: `/tenants/${normalizedTenantId}/buildings`,
        headers: { 'tenant-id': normalizedTenantId },
      });
      return parseBuildingSummaries(data);
    },
  });

  const liquidationsQuery = useQuery({
    queryKey: ['liquidations', normalizedTenantId, refreshTrigger],
    enabled: hasValidTenantId,
    queryFn: async () => {
      const data = await apiClient<unknown>({
        path: `/tenants/${normalizedTenantId}/finance/liquidations`,
        headers: { 'tenant-id': normalizedTenantId },
      });
      return parseLiquidationsListItems(data);
    },
  });

  const handleRefresh = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  const buildings = buildingsQuery.data ?? [];
  const liquidations = liquidationsQuery.data ?? [];
  const hasError = liquidationsQuery.isError || buildingsQuery.isError;

  const groupedLiquidations = statusTabs.reduce<Record<LiquidationStatus, LiquidationsListItem[]>>(
    (acc, tab) => {
      acc[tab.value] = liquidations.filter((l) => l.status === tab.value);
      return acc;
    },
    {
      DRAFT: [],
      REVIEWED: [],
      PUBLISHED: [],
      CANCELED: [],
    },
  );

  const activeTabData = groupedLiquidations[activeTab];

  if (!hasValidTenantId) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
        Tenant inválido
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold">Liquidaciones</h1>
          {!buildingsQuery.isLoading && (
            <CreateLiquidationModal
              tenantId={normalizedTenantId}
              buildings={buildings}
              onSuccess={handleRefresh}
            />
          )}
        </div>
        <p className="text-gray-600">Crea y gestiona las liquidaciones de expensas por período</p>
      </div>

      {liquidationsQuery.isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <div>
            <p className="font-medium text-red-900">Error al cargar liquidaciones</p>
            <p className="text-sm text-red-700">Por favor, intente nuevamente</p>
          </div>
        </div>
      )}

      {buildingsQuery.isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <div>
            <p className="font-medium text-red-900">Error al cargar edificios</p>
            <p className="text-sm text-red-700">No se puede crear una liquidación hasta recuperar los edificios</p>
          </div>
        </div>
      )}

      {(liquidationsQuery.isLoading || buildingsQuery.isLoading) && (
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {!hasError && !liquidationsQuery.isLoading && !buildingsQuery.isLoading && liquidations.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-8 text-center">
          <AlertCircle className="w-8 h-8 text-blue-600 mx-auto mb-2" />
          <p className="font-medium text-blue-900">No hay liquidaciones aún</p>
          <p className="text-sm text-blue-700">Crea una nueva para comenzar</p>
        </div>
      )}

      {!hasError && !liquidationsQuery.isLoading && !buildingsQuery.isLoading && liquidations.length > 0 && (
        <div>
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

          <div className="space-y-4">
            {activeTabData.length === 0 ? (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
                <p className="text-gray-600">
                  No hay liquidaciones en estado {statusTabs.find((t) => t.value === activeTab)?.label.toLowerCase()}
                </p>
              </div>
            ) : (
              activeTabData.map((liq: LiquidationsListItem) => (
                <LiquidationDraftCard
                  key={liq.id}
                  tenantId={normalizedTenantId}
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
