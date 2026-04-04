'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Card from '@/shared/components/ui/Card';
import { Skeleton } from '@/shared/components/ui';
import { useNotasRevelatorias } from '../hooks/useExpenseLedger';

// react-pdf usa APIs del browser — importar solo en cliente
const NotasRevelatoriasPDF = dynamic(
  () => import('./NotasRevelatoriasPDF').then((m) => ({ default: m.NotasRevelatoriasPDF })),
  { ssr: false, loading: () => <span className="text-sm text-muted-foreground">Cargando PDF...</span> },
);

interface Props {
  tenantId: string;
}

function currentPeriod() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

export function NotasRevelatoriasPanel({ tenantId }: Props) {
  const [period, setPeriod] = useState(currentPeriod);
  const { data: report, isLoading, error } = useNotasRevelatorias(tenantId, period);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-end gap-4">
          <div className="flex-1">
            <h2 className="font-semibold text-base mb-1">Notas Revelatorias</h2>
            <p className="text-sm text-muted-foreground">
              Reporte mensual de ingresos, gastos comunes, gastos propios por edificio y alícuotas.
              Seleccioná el mes y descargá el PDF.
            </p>
          </div>
          <div className="flex items-end gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Período</label>
              <input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="border rounded-md px-2 py-1.5 text-sm bg-background"
              />
            </div>
            {isLoading && (
              <span className="text-sm text-muted-foreground pb-1.5">Cargando datos...</span>
            )}
            {!isLoading && report && (
              <NotasRevelatoriasPDF report={report} />
            )}
          </div>
        </div>
      </Card>

      {error && (
        <Card>
          <div className="p-4 text-sm text-destructive">Error al cargar el reporte</div>
        </Card>
      )}

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      )}

      {!isLoading && report && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Ingresos totales (USD)"
            value={`$${(report.buildingIncomes.reduce((s, b) => s + b.totalUSD, 0) / 100).toFixed(2)}`}
          />
          <StatCard
            label="Gastos comunes (USD)"
            value={`$${(report.commonTotals.usd / 100).toFixed(2)}`}
          />
          <StatCard
            label="Notas registradas"
            value={String(
              1 + report.buildingIncomes.length + report.buildingExpenses.length + report.reservaLegal.length,
            )}
          />
          <StatCard
            label="Gastos comunes (líneas)"
            value={String(report.commonExpenses.length)}
          />
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums mt-1">{value}</p>
    </Card>
  );
}
