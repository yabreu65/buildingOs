'use client';

import { useState } from 'react';
import { useFinanceSummary } from '../hooks/useFinanceSummary';
import { useCharges } from '../hooks/useCharges';
import { usePaymentsReview, usePaymentHistory } from '../hooks/usePaymentsReview';
import { FinanceSummaryCards } from './FinanceSummaryCards';
import { PaymentsReviewList } from './PaymentsReviewList';
import { PaymentHistoryList } from './PaymentHistoryList';
import { ChargesTab } from './ChargesTab';
import { DelinquentUnitsList } from './DelinquentUnitsList';
import { FinanceChartsPanel } from './FinanceChartsPanel';
import { ExpensesList } from './ExpensesList';
import { ExpenseLedgerCategoriesManager } from './ExpenseLedgerCategoriesManager';
import { LiquidationsTab } from './LiquidationsTab';
import { useExpenses } from '../hooks/useExpenseLedger';
import { cn } from '@/shared/lib/utils';

interface FinanceDashboardProps {
  buildingId: string;
  tenantId: string;
}

type TabType = 'rubros' | 'expenses' | 'liquidations' | 'payments' | 'payments-history' | 'charges' | 'delinquent' | 'analysis';

/**
 * FinanceDashboard: Main orchestrator for finance management
 * Displays KPI cards and three tabs: Pending Payments, Charges, Delinquent Units
 */
export function FinanceDashboard({ buildingId, tenantId }: FinanceDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabType>('rubros');
  const [period, setPeriod] = useState<string>('');

  // Load data from hooks
  const { data: summary, isPending: summaryLoading, error: summaryError, refetch: refetchSummaryRaw } = useFinanceSummary(buildingId, period);
  const { data: charges, isPending: chargesLoading, error: chargesError, refetch: refetchChargesRaw } = useCharges(buildingId, period);
  const { data: payments, isPending: paymentsLoading, error: paymentsError, refetch: refetchPaymentsRaw } = usePaymentsReview(buildingId, 'SUBMITTED');
  const { data: paymentHistory, isPending: paymentHistoryLoading, error: paymentHistoryError, refetch: refetchPaymentHistoryRaw } = usePaymentHistory(buildingId);
  const { data: expenses = [], isPending: expensesLoading, error: expensesError, refetch: refetchExpensesRaw } = useExpenses(tenantId, { buildingId, period: period || undefined });

  // Wrap refetch functions to match component prop signatures
  const refetchSummary = async () => {
    await refetchSummaryRaw();
  };

  const refetchCharges = async () => {
    await refetchChargesRaw();
  };

  const refetchPayments = async () => {
    await refetchPaymentsRaw();
  };

  const refetchPaymentHistory = async () => {
    await refetchPaymentHistoryRaw();
  };

  const refetchExpenses = async () => {
    await refetchExpensesRaw();
  };

  const handlePaymentApproved = async () => {
    await refetchPayments();
    await refetchPaymentHistory();
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

  // Convert React Query errors to string messages
  const summaryErrorMsg = summaryError ? (summaryError instanceof Error ? summaryError.message : String(summaryError)) : null;
  const chargesErrorMsg = chargesError ? (chargesError instanceof Error ? chargesError.message : String(chargesError)) : null;
  const paymentsErrorMsg = paymentsError ? (paymentsError instanceof Error ? paymentsError.message : String(paymentsError)) : null;
  const paymentHistoryErrorMsg = paymentHistoryError ? (paymentHistoryError instanceof Error ? paymentHistoryError.message : String(paymentHistoryError)) : null;
  const expensesErrorMsg = expensesError ? (expensesError instanceof Error ? expensesError.message : String(expensesError)) : null;

  const tabs: Array<{ id: TabType; label: string; count?: number }> = [
    { id: 'rubros', label: 'Rubros' },
    { id: 'expenses', label: 'Gastos', count: expenses?.length },
    { id: 'liquidations', label: 'Liquidaciones' },
    { id: 'payments', label: 'Pagos Pendientes', count: payments?.length },
    { id: 'payments-history', label: 'Historial de Pagos', count: paymentHistory?.length },
    { id: 'charges', label: 'Cargos' },
    { id: 'delinquent', label: 'Unidades Morosas', count: summary?.delinquentUnitsCount },
    { id: 'analysis', label: 'Análisis' },
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
        summary={summary ?? null}
        loading={summaryLoading}
        error={summaryErrorMsg}
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
        {activeTab === 'rubros' && (
          <ExpenseLedgerCategoriesManager tenantId={tenantId} />
        )}

        {activeTab === 'expenses' && (
          <ExpensesList
            tenantId={tenantId}
            buildingId={buildingId}
            period={period || new Date().toISOString().split('T')[0].slice(0, 7)}
            expenses={expenses}
            loading={expensesLoading}
            error={expensesErrorMsg}
            onRefresh={refetchExpenses}
          />
        )}

        {activeTab === 'liquidations' && (
          <LiquidationsTab
            tenantId={tenantId}
            buildingId={buildingId}
            period={period}
            currency={summary?.currency || 'ARS'}
          />
        )}

        {activeTab === 'payments' && (
          <PaymentsReviewList
            buildingId={buildingId}
            tenantId={tenantId}
            payments={payments || []}
            loading={paymentsLoading}
            error={paymentsErrorMsg}
            onPaymentApproved={handlePaymentApproved}
            onPaymentRejected={handlePaymentRejected}
            onRefresh={refetchPayments}
          />
        )}

        {activeTab === 'payments-history' && (
          <PaymentHistoryList
            buildingId={buildingId}
            tenantId={tenantId}
            payments={paymentHistory || []}
            loading={paymentHistoryLoading}
            error={paymentHistoryErrorMsg}
            onRefresh={refetchPaymentHistory}
          />
        )}

        {activeTab === 'charges' && (
          <ChargesTab
            buildingId={buildingId}
            charges={charges || []}
            loading={chargesLoading}
            error={chargesErrorMsg}
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

        {activeTab === 'analysis' && (
          <FinanceChartsPanel buildingId={buildingId} period={period} />
        )}
      </div>
    </div>
  );
}
