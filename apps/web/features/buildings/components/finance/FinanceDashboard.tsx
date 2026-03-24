'use client';

import { useState } from 'react';
import { useFinanceSummary } from '../../hooks/useFinanceSummary';
import { useCharges } from '../../hooks/useCharges';
import { usePaymentsReview } from '../../hooks/usePaymentsReview';
import { FinanceSummaryCards } from './FinanceSummaryCards';
import { PaymentsReviewList } from './PaymentsReviewList';
import { ChargesTab } from './ChargesTab';
import { DelinquentUnitsList } from './DelinquentUnitsList';
import { cn } from '@/shared/lib/utils';

interface FinanceDashboardProps {
  buildingId: string;
  tenantId: string;
}

type TabType = 'payments' | 'charges' | 'delinquent';

/**
 * FinanceDashboard: Main orchestrator for finance management
 * Displays KPI cards and three tabs: Pending Payments, Charges, Delinquent Units
 */
export function FinanceDashboard({ buildingId, tenantId }: FinanceDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabType>('payments');
  const [period, setPeriod] = useState<string>('');

  // Load data from hooks
  const { summary, loading: summaryLoading, error: summaryError, refetch: refetchSummary } = useFinanceSummary(buildingId, period);
  const { charges, loading: chargesLoading, error: chargesError, refetch: refetchCharges } = useCharges(buildingId, period);
  const { payments, loading: paymentsLoading, error: paymentsError, refetch: refetchPayments } = usePaymentsReview(buildingId, 'SUBMITTED');

  const handlePaymentApproved = async () => {
    await refetchPayments();
    await refetchSummary();
  };

  const handlePaymentRejected = async () => {
    await refetchPayments();
    await refetchSummary();
  };

  const handleChargeCreated = async () => {
    await refetchCharges();
    await refetchSummary();
  };

  const tabs: Array<{ id: TabType; label: string; count?: number }> = [
    { id: 'payments', label: 'Pagos Pendientes', count: payments.length },
    { id: 'charges', label: 'Cargos' },
    { id: 'delinquent', label: 'Unidades Morosas', count: summary?.delinquentUnitsCount },
  ];

  return (
    <div className="space-y-6">
      {/* Header with period selector */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Finanzas</h1>
        <div>
          <label className="text-sm font-medium text-gray-600 mr-2">Período:</label>
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {/* KPI Cards */}
      <FinanceSummaryCards
        summary={summary}
        loading={summaryLoading}
        error={summaryError}
        onRetry={refetchSummary}
      />

      {/* Tabs */}
      <div className="border-b mb-6">
        <nav className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-4 py-2 border-b-2 transition -mb-px flex items-center gap-2',
                activeTab === tab.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="inline-block px-2 py-1 bg-gray-100 text-gray-700 text-xs font-semibold rounded-full">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'payments' && (
          <PaymentsReviewList
            buildingId={buildingId}
            payments={payments}
            loading={paymentsLoading}
            error={paymentsError}
            onPaymentApproved={handlePaymentApproved}
            onPaymentRejected={handlePaymentRejected}
            onRefresh={refetchPayments}
          />
        )}

        {activeTab === 'charges' && (
          <ChargesTab
            buildingId={buildingId}
            charges={charges}
            loading={chargesLoading}
            error={chargesError}
            onChargeCreated={handleChargeCreated}
            onRefresh={refetchCharges}
          />
        )}

        {activeTab === 'delinquent' && (
          <DelinquentUnitsList
            units={summary?.topDelinquentUnits || []}
            loading={summaryLoading}
            currency={summary?.currency || 'ARS'}
          />
        )}
      </div>
    </div>
  );
}
