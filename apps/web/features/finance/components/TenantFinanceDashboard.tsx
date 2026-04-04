'use client';

import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import Card from '@/shared/components/ui/Card';
import Button from '@/shared/components/ui/Button';
import { FinanceSummaryCards } from './FinanceSummaryCards';
import { BuildingsFinanceSummary } from './BuildingsFinanceSummary';
import { TenantDelinquentUnitsList } from './TenantDelinquentUnitsList';
import { PaymentApproveModal } from './PaymentApproveModal';
import { useTenantFinanceSummary } from '../hooks/useTenantFinanceSummary';
import { useBuildings } from '@/features/buildings/hooks';
import { Skeleton } from '@/shared/components/ui';
import { cn } from '@/shared/lib/utils';
import { listPendingPayments, getPaymentMetrics, PaymentStatus, approvePaymentTenant } from '@/features/finance/services/finance.api';
import { TenantChargesTab } from './TenantChargesTab';
import { ExpenseLedgerCategoriesManager } from './ExpenseLedgerCategoriesManager';
import { TenantExpensesList } from './TenantExpensesList';
import { ExpenseHistoryReport } from './ExpenseHistoryReport';
import { NotasRevelatoriasPanel } from './NotasRevelatoriasPanel';
import { useExpenses } from '../hooks/useExpenseLedger';

type Tab = 'overview' | 'rubros' | 'expenses' | 'payments' | 'charges' | 'delinquent' | 'reports' | 'notas';

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
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: summary, isPending: loading, error, refetch } = useTenantFinanceSummary(tenantId, period);
  const { buildings, loading: buildingsLoading } = useBuildings(tenantId);

  // Tenant-level payments and metrics
  const { data: payments = [], isLoading: paymentsLoading } = useQuery({
    queryKey: ['tenantPayments', tenantId],
    queryFn: () => listPendingPayments(tenantId!, { status: PaymentStatus.SUBMITTED }),
    enabled: !!tenantId && activeTab === 'payments',
    staleTime: 2 * 60 * 1000,
  });

  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ['paymentMetrics', tenantId],
    queryFn: () => getPaymentMetrics(tenantId!),
    enabled: !!tenantId && activeTab === 'payments',
    staleTime: 5 * 60 * 1000,
  });

  // Tenant-level expenses (TENANT_SHARED scope - gastos comunes)
  const { data: tenantExpenses = [], isLoading: tenantExpensesLoading, refetch: refetchTenantExpenses } = useExpenses(
    tenantId || '',
    { period: period || undefined, status: undefined, scopeType: 'TENANT_SHARED' }
  );

  // Filter: only TENANT_SHARED and not VOID
  const visibleTenantExpenses = tenantExpenses.filter(
    (e) => e.scopeType === 'TENANT_SHARED' && e.status !== 'VOID'
  );

  // Payment approval mutation
  const { mutateAsync: approve, isPending: isApproving } = useMutation({
    mutationFn: (paidAt?: string) => approvePaymentTenant(tenantId!, selectedPaymentId!, paidAt),
    onSuccess: () => {
      setSelectedPaymentId(null);
      queryClient.invalidateQueries({ queryKey: ['tenantPayments', tenantId] });
    },
  });

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
       <div className="space-y-3">
         <h1 className="text-2xl font-bold">Resumen financiero</h1>
         <p className="text-sm text-muted-foreground">
           Estado consolidado de {buildingIds.length} edificio{buildingIds.length !== 1 ? 's' : ''}
         </p>
       </div>

      {/* KPI Cards */}
      <FinanceSummaryCards summary={summary ?? null} loading={loading} error={errorMsg} onRetry={refetch} />

        {/* Tabs */}
        <div className="space-y-4">
           <div className="flex flex-wrap gap-2">
             {[
               { id: 'overview', label: 'Resumen' },
               { id: 'expenses', label: `Gastos comunes (${visibleTenantExpenses.length})` },
               { id: 'rubros', label: 'Rubros' },
               { id: 'payments', label: `Pagos (${payments.length})` },
               { id: 'charges', label: 'Cargos' },
               { id: 'delinquent', label: `Morosos (${summary?.delinquentUnitsCount || 0})` },
               { id: 'reports', label: 'Historial de gastos' },
               { id: 'notas', label: 'Notas Revelatorias' },
             ].map((tab) => (
             <button
               key={tab.id}
               onClick={() => setActiveTab(tab.id as Tab)}
               className={cn(
                 'px-3 py-2 rounded-md text-sm font-medium transition-all',
                 activeTab === tab.id
                   ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                   : 'bg-muted text-muted-foreground hover:bg-muted/50 hover:text-foreground'
               )}
             >
               {tab.label}
             </button>
           ))}
         </div>
       </div>

      {/* Tab Content */}
      <div className="space-y-4">
        {activeTab === 'overview' && (
          <>
            {buildingsLoading ? (
              <>
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </>
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
            )}
          </>
        )}
        {activeTab === 'expenses' && (
          <TenantExpensesList
            tenantId={tenantId || ''}
            period={period || new Date().toISOString().split('T')[0].slice(0, 7)}
            expenses={visibleTenantExpenses}
            loading={tenantExpensesLoading}
            error={null}
            onRefresh={() => void refetchTenantExpenses()}
          />
        )}
        {activeTab === 'rubros' && (
          <ExpenseLedgerCategoriesManager
            tenantId={tenantId || ''}
            defaultScopeFilter="CONDOMINIUM_COMMON"
          />
        )}
        {activeTab === 'payments' && (
          <>
            {paymentsLoading ? (
              <>
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </>
            ) : payments.length === 0 ? (
              <Card>
                <div className="p-6 text-center text-gray-600">
                  <p className="text-sm">No hay pagos para aprobar</p>
                  <p className="text-xs text-muted-foreground mt-2">Los pagos serán listados aquí cuando se registren</p>
                </div>
              </Card>
            ) : (
              <div className="space-y-4">
                {payments.map((payment) => (
                  <Card key={payment.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1 flex-1">
                        <p className="text-sm font-medium">{payment.building?.name || buildingNames[payment.buildingId] || payment.buildingId}</p>
                        <p className="text-xs text-muted-foreground">Unidad: {payment.unit?.label || payment.unitId}</p>
                        <p className="text-xs text-muted-foreground">Monto: ${payment.amount.toFixed(2)}</p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => setSelectedPaymentId(payment.id)}
                        className="ml-4"
                      >
                        Aprobar
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
        {activeTab === 'charges' && (
          <TenantChargesTab tenantId={tenantId || ''} buildingNames={buildingNames} />
        )}
        {activeTab === 'delinquent' && (
          <TenantDelinquentUnitsList delinquent={summary?.topDelinquentUnits || []} loading={loading} />
        )}
        {activeTab === 'reports' && (
          <ExpenseHistoryReport tenantId={tenantId || ''} />
        )}
        {activeTab === 'notas' && (
          <NotasRevelatoriasPanel tenantId={tenantId || ''} />
        )}
      </div>

      {/* Payment Approval Modal */}
      {selectedPaymentId && (
        <PaymentApproveModal
          paymentId={selectedPaymentId}
          onConfirm={(paidAt) => approve(paidAt).then(() => undefined)}
          onCancel={() => setSelectedPaymentId(null)}
          isSubmitting={isApproving}
        />
      )}
    </div>
  );
};
