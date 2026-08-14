'use client';

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useFinanceSummary } from '../hooks/useFinanceSummary';
import { useFinanceTrend } from '../hooks/useFinanceTrend';
import { formatCurrency } from '@/shared/lib/format/money';
import { formatCurrencyBuckets } from '@/shared/lib/format/currency-buckets';
import Skeleton from '@/shared/components/ui/Skeleton';
import Card from '@/shared/components/ui/Card';

interface FinanceChartsPanelProps {
  buildingId: string;
  period?: string;
}

// Format money with its explicit currency (minor units). Never guesses.
const formatMoney = (cents: number, currency: string) =>
  formatCurrency(cents, currency);

const formatPercentage = (val: number) => `${Math.round(val)}%`;

/**
 * Component displaying financial charts and metrics for a building.
 * @param buildingId - Building ID to fetch financial data for
 * @param period - Optional period filter for the financial summary
 * @returns Chart panel with bar chart, collection rate, and trend line chart
 */
export function FinanceChartsPanel({ buildingId, period }: FinanceChartsPanelProps) {
  const { data: summary, isPending: summaryLoading, error: summaryError } =
    useFinanceSummary(buildingId, period);
  const { data: trend, isPending: trendLoading, error: trendError } = useFinanceTrend(buildingId, 6);

  // One bar-group per currency; currencies are never mixed in a bar.
  const barChartData = useMemo(() => {
    if (!summary) return [];
    return summary.totalChargesByCurrency.map((bucket) => {
      const paid = summary.totalPaidByCurrency.find((b) => b.currency === bucket.currency);
      const outstanding = summary.totalOutstandingByCurrency.find((b) => b.currency === bucket.currency);
      return {
        name: bucket.currency,
        Cargos: bucket.amountMinor / 100,
        Pagado: (paid?.amountMinor ?? 0) / 100,
        Pendiente: (outstanding?.amountMinor ?? 0) / 100,
      };
    });
  }, [summary]);

  const collectionRateByCurrency = useMemo(() => {
    if (!summary) return [];
    return summary.totalChargesByCurrency.map((bucket) => {
      const paid = summary.totalPaidByCurrency.find((b) => b.currency === bucket.currency);
      return {
        currency: bucket.currency,
        rate:
          bucket.amountMinor > 0
            ? ((paid?.amountMinor ?? 0) / bucket.amountMinor) * 100
            : 0,
      };
    });
  }, [summary]);

  // Trend rows: one series per currency for paid amounts.
  const trendData = useMemo(() => {
    if (!trend) return [];
    const currencies = new Set<string>();
    trend.forEach((t) =>
      t.totalPaidByCurrency.forEach((b) => currencies.add(b.currency)),
    );
    return trend.map((t) => {
      const row: Record<string, string | number> = { period: t.period };
      for (const c of currencies) {
        const paid = t.totalPaidByCurrency.find((b) => b.currency === c);
        row[`paid_${c}`] = (paid?.amountMinor ?? 0) / 100;
      }
      return row;
    });
  }, [trend]);

  const trendCurrencies = useMemo(() => {
    if (!trend) return [];
    const currencies = new Set<string>();
    trend.forEach((t) =>
      t.totalPaidByCurrency.forEach((b) => currencies.add(b.currency)),
    );
    return Array.from(currencies);
  }, [trend]);

  if (summaryError || trendError) {
    const errorMessage = summaryError || trendError || 'Error al cargar gráficos';
    return (
      <Card className="border-red-200 bg-red-50 p-4">
        <div className="space-y-2 text-center text-red-700">
          <p className="text-sm font-medium text-red-900">No pudimos cargar los gráficos financieros</p>
          <p className="text-sm">
            {typeof errorMessage === 'string' ? errorMessage : errorMessage.message}
          </p>
        </div>
      </Card>
    );
  }

  if (summaryLoading || trendLoading) {
    return (
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
        <Skeleton className="col-span-full h-80" />
      </div>
    );
  }

  if (!summary || !trend) {
    return (
      <Card className="border-gray-200 bg-gray-50 p-4">
        <div className="text-center text-sm text-gray-600">No hay datos financieros disponibles</div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top row: Bar Chart + Collection Rate */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Bar Chart */}
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="mb-4 text-sm font-semibold text-gray-900">
            Cargos vs Pagado vs Pendiente
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={barChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis
                tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                formatter={(val) => String(val)}
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: '0.5rem',
                }}
              />
              <Legend />
              <Bar dataKey="Cargos" fill="#3b82f6" />
              <Bar dataKey="Pagado" fill="#10b981" />
              <Bar dataKey="Pendiente" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Collection Rate Card */}
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="mb-4 text-sm font-semibold text-gray-900">
            Tasa de Cobranza
          </h3>
          <div className="space-y-4">
            {/* Progress bar */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-2xl font-bold text-gray-900">
                  {collectionRateByCurrency.length === 0
                    ? '—'
                    : collectionRateByCurrency
                        .map((r) => formatPercentage(r.rate))
                        .join(' · ')}
                </span>
                <span className="text-xs text-gray-500">cobrado por moneda</span>
              </div>
              <div className="space-y-1 text-xs text-gray-500">
                {collectionRateByCurrency.map((r) => (
                  <div key={r.currency} className="flex justify-between">
                    <span>{r.currency}</span>
                    <span className="font-semibold text-gray-700">{formatPercentage(r.rate)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Stats */}
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Cargos totales:</span>
                <span className="font-semibold">{formatCurrencyBuckets(summary.totalChargesByCurrency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Pagado:</span>
                <span className="font-semibold text-green-600">
                  {formatCurrencyBuckets(summary.totalPaidByCurrency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Pendiente:</span>
                <span className="font-semibold text-red-600">
                  {formatCurrencyBuckets(summary.totalOutstandingByCurrency)}
                </span>
              </div>
              <div className="border-t border-gray-200 pt-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Unidades morosas:</span>
                  <span className="font-bold text-red-600">
                    {summary.delinquentUnitsCount}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom: Trend Line Chart */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-4 text-sm font-semibold text-gray-900">
          Evolución últimos 6 meses
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={trendData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="period"
              tick={{ fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis
              tickFormatter={(val) => `${val.toLocaleString('es-AR')}`}
              tick={{ fontSize: 12 }}
            />
            <Tooltip
              formatter={(val) => String(val)}
              labelFormatter={(label) => `Período: ${label}`}
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '0.5rem',
              }}
            />
            <Legend />
            {trendCurrencies.map((c, i) => (
              <Line
                key={c}
                type="monotone"
                dataKey={`paid_${c}`}
                stroke={['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444'][i % 5]}
                strokeWidth={2}
                name={`Pagado ${c}`}
                dot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
