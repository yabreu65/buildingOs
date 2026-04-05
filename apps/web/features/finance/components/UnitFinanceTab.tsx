'use client';

import { useState } from 'react';
import Card from '@/shared/components/ui/Card';
import { Skeleton, ErrorState, EmptyState } from '@/shared/components/ui';
import { useUnitLedger } from '../hooks/useUnitLedger';
import { formatCurrency } from '@/shared/lib/format/money';
import { DollarSign, TrendingUp, Calendar } from 'lucide-react';

interface UnitFinanceTabProps {
  buildingId: string;
  unitId: string;
  buildingName?: string;
  unitLabel?: string;
}

export function UnitFinanceTab({ buildingId, unitId, buildingName, unitLabel }: UnitFinanceTabProps) {
  const { data: ledger, isLoading, error, refetch } = useUnitLedger(buildingId, unitId);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error instanceof Error ? error.message : 'Error loading finances'} onRetry={() => refetch()} />;
  }

  if (!ledger || (ledger.charges.length === 0 && ledger.payments.length === 0)) {
    return (
      <div className="space-y-6">
        <div className="border-b pb-4">
          <p className="text-sm text-muted-foreground">
            {buildingName ? `${buildingName} / ` : ''}Unidad {unitLabel}
          </p>
        </div>
        <EmptyState
          title="Sin cargos registrados"
          description="Esta unidad no tiene cargos ni pagos registrados en el sistema. Crea el primer cargo desde la pestaña de Finanzas del edificio."
        />
      </div>
    );
  }

  // Group charges by period
  const chargesByPeriod = ledger.charges.reduce(
    (acc, charge) => {
      const period = charge.period || 'Sin período';
      if (!acc[period]) {
        acc[period] = [];
      }
      acc[period].push(charge);
      return acc;
    },
    {} as Record<string, typeof ledger.charges>
  );

  const pendingCharges = ledger.charges.filter((c) => c.status !== 'PAID');
  const lastPayment = ledger.payments && ledger.payments.length > 0 ? ledger.payments[0] : null;

  return (
    <div className="space-y-6">
      {/* Header with building and unit context */}
      <div className="border-b pb-4">
        <p className="text-sm text-muted-foreground">
          {buildingName ? `${buildingName} / ` : ''}Unidad {unitLabel}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Deuda Total</p>
              <p className="text-2xl font-bold text-orange-600">
                {ledger.totals?.totalCharges ? formatCurrency(ledger.totals.totalCharges, ledger.totals.currency || 'USD') : '$0.00'}
              </p>
            </div>
            <DollarSign className="w-5 h-5 text-orange-600" />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Pagado</p>
              <p className="text-2xl font-bold text-green-600">
                {ledger.totals?.totalPaid ? formatCurrency(ledger.totals.totalPaid, ledger.totals.currency || 'USD') : '$0.00'}
              </p>
            </div>
            <TrendingUp className="w-5 h-5 text-green-600" />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Último Pago</p>
              <p className="text-lg font-semibold">
                {lastPayment ? (
                  <span>
                    {formatCurrency(lastPayment.amount, lastPayment.currency || 'USD')}
                    <span className="block text-xs text-muted-foreground mt-1">
                      {lastPayment.paidAt ? new Date(lastPayment.paidAt).toLocaleDateString('es-AR') : '—'}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </p>
            </div>
            <Calendar className="w-5 h-5 text-blue-600" />
          </div>
        </Card>
      </div>

      {/* Pending Charges */}
      {pendingCharges.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Cargos Pendientes ({pendingCharges.length})</h3>
          <div className="space-y-3">
            {Object.entries(chargesByPeriod).map(([period, charges]) => {
              const periodPending = charges.filter((c) => c.status !== 'PAID');
              if (periodPending.length === 0) return null;

              const periodTotal = periodPending.reduce((sum, c) => sum + (c.amount || 0), 0);
              const isExpanded = expandedMonth === period;

              return (
                <div key={period} className="border rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedMonth(isExpanded ? null : period)}
                    className="w-full p-4 flex items-center justify-between hover:bg-muted/50 transition"
                  >
                    <div className="flex-1 text-left">
                      <p className="font-semibold">{period}</p>
                      <p className="text-sm text-muted-foreground">{periodPending.length} cargo(s) pendiente(s)</p>
                    </div>
                    <p className="font-bold text-orange-600">
                      {formatCurrency(periodTotal, periodPending[0]?.currency || 'USD')}
                    </p>
                  </button>

                  {isExpanded && (
                    <div className="bg-muted/30 border-t divide-y">
                      {periodPending.map((charge) => (
                        <div key={charge.id} className="p-4 flex items-center justify-between">
                          <div className="flex-1">
                            <p className="font-medium">{charge.concept || 'Cargo'}</p>
                            <p className="text-sm text-muted-foreground">Status: {charge.status}</p>
                          </div>
                          <p className="font-semibold">
                            {formatCurrency(charge.amount || 0, charge.currency || 'USD')}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pendingCharges.length === 0 && (
        <EmptyState
          title="Sin cargos pendientes"
          description="Esta unidad está al día con todos sus pagos"
        />
      )}

      {/* Payment History */}
      {ledger.payments.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Historial de Pagos</h3>
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted/50 grid grid-cols-3 gap-4 p-3 font-semibold text-sm">
              <div>Fecha</div>
              <div className="text-right">Monto</div>
              <div className="text-right">Método</div>
            </div>
            <div className="divide-y">
              {ledger.payments.map((payment) => (
                <div key={payment.id} className="grid grid-cols-3 gap-4 p-4 hover:bg-muted/30 transition">
                  <div>{payment.paidAt ? new Date(payment.paidAt).toLocaleDateString('es-AR') : new Date(payment.createdAt).toLocaleDateString('es-AR')}</div>
                  <div className="text-right font-semibold text-green-600">
                    {formatCurrency(payment.amount, payment.currency || 'USD')}
                  </div>
                  <div className="text-right text-sm text-muted-foreground">
                    {payment.method || '—'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
