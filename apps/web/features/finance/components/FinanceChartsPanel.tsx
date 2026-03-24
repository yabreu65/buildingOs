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
  Cell,
} from 'recharts';
import { useFinanceSummary } from '../hooks/useFinanceSummary';
import { useFinanceTrend } from '../hooks/useFinanceTrend';
import Skeleton from '@/shared/components/ui/Skeleton';
import ErrorState from '@/shared/components/ui/ErrorState';

interface FinanceChartsPanelProps {
  buildingId: string;
  period?: string;
}

// Format ARS currency (divide by 100, two decimals)
const formatARS = (cents: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(cents / 100);

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

  const barChartData = useMemo(() => {
    if (!summary) return [];
    return [
      {
        name: 'Cargos vs Pagos',
        Cargos: summary.totalCharges / 100,
        Pagado: summary.totalPaid / 100,
        Pendiente: summary.totalOutstanding / 100,
      },
    ];
  }, [summary]);

  const collectionRate = useMemo(() => {
    if (!summary || summary.totalCharges === 0) return 0;
    return (summary.totalPaid / summary.totalCharges) * 100;
  }, [summary]);

  if (summaryError || trendError) {
    const errorMessage = summaryError || trendError || 'Error al cargar gráficos';
    return (
      <ErrorState
        message={typeof errorMessage === 'string' ? errorMessage : errorMessage.message}
      />
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
      <ErrorState message="No hay datos disponibles" />
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
                formatter={(val) => formatARS((val as number) * 100)}
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
                  {formatPercentage(collectionRate)}
                </span>
                <span className="text-xs text-gray-500">cobrado</span>
              </div>
              <div className="h-3 w-full rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-green-500 transition-all"
                  style={{ width: `${Math.min(collectionRate, 100)}%` }}
                />
              </div>
            </div>

            {/* Stats */}
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Cargos totales:</span>
                <span className="font-semibold">{formatARS(summary.totalCharges)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Pagado:</span>
                <span className="font-semibold text-green-600">
                  {formatARS(summary.totalPaid)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Pendiente:</span>
                <span className="font-semibold text-red-600">
                  {formatARS(summary.totalOutstanding)}
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
          <LineChart data={trend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="period"
              tick={{ fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis
              tickFormatter={(val) => `$${(val / 100000).toFixed(0)}k`}
              tick={{ fontSize: 12 }}
            />
            <Tooltip
              formatter={(val) => formatARS((val as number))}
              labelFormatter={(label) => `Período: ${label}`}
              contentStyle={{
                backgroundColor: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '0.5rem',
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="totalPaid"
              stroke="#10b981"
              strokeWidth={2}
              name="Pagado"
              dot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="totalOutstanding"
              stroke="#ef4444"
              strokeWidth={2}
              name="Pendiente"
              dot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
