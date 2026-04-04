'use client';

import { useState } from 'react';
import Card from '@/shared/components/ui/Card';
import { Skeleton } from '@/shared/components/ui';
import { cn } from '@/shared/lib/utils';
import { useExpenseReports } from '../hooks/useExpenseLedger';
import type { ExpensePeriodReport } from '../services/expense-ledger.api';

interface Props {
  tenantId: string;
}

function formatAmount(minor: number, currency = 'ARS') {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

function formatPeriod(period: string) {
  const [year, month] = period.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleString('es-AR', { month: 'long', year: 'numeric' });
}

function exportCsv(reports: ExpensePeriodReport[]) {
  const rows: string[] = [
    'Período,Edificio,Gastos propios,Porción comunes,Total',
  ];

  for (const r of reports) {
    for (const b of r.byBuilding) {
      rows.push(
        [
          r.period,
          `"${b.buildingName}"`,
          (b.buildingExpenses / 100).toFixed(2),
          (b.sharedPortion / 100).toFixed(2),
          (b.total / 100).toFixed(2),
        ].join(','),
      );
    }
    rows.push(
      [r.period, '"TOTAL"', '', '', (r.totalTenant / 100).toFixed(2)].join(','),
    );
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gastos-historico-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExpenseHistoryReport({ tenantId }: Props) {
  const { data: reports = [], isLoading, error } = useExpenseReports(tenantId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(period: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(period)) next.delete(period);
      else next.add(period);
      return next;
    });
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <div className="p-6 text-center text-destructive text-sm">
          Error al cargar el historial de gastos
        </div>
      </Card>
    );
  }

  if (reports.length === 0) {
    return (
      <Card>
        <div className="p-6 text-center text-muted-foreground text-sm">
          No hay gastos validados registrados todavía
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {reports.length} período{reports.length !== 1 ? 's' : ''} con gastos validados
        </p>
        <button
          onClick={() => exportCsv(reports)}
          className="text-xs px-3 py-1.5 rounded-md bg-muted hover:bg-muted/70 text-muted-foreground hover:text-foreground transition-colors"
        >
          Exportar CSV
        </button>
      </div>

      <div className="space-y-2">
        {reports.map((report) => {
          const isOpen = expanded.has(report.period);
          return (
            <Card key={report.period} className="overflow-hidden">
              <button
                onClick={() => toggle(report.period)}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      'text-xs transition-transform',
                      isOpen ? 'rotate-90' : '',
                    )}
                  >
                    ▶
                  </span>
                  <div>
                    <p className="font-medium capitalize">
                      {formatPeriod(report.period)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {report.byBuilding.length} edificio
                      {report.byBuilding.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">
                    {formatAmount(report.totalTenant)}
                  </p>
                  {report.sharedTotal > 0 && (
                    <p className="text-xs text-muted-foreground">
                      incl. {formatAmount(report.sharedTotal)} comunes
                    </p>
                  )}
                </div>
              </button>

              {isOpen && (
                <div className="border-t">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/40">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                          Edificio
                        </th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">
                          Propios
                        </th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">
                          Comunes
                        </th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.byBuilding.map((b) => (
                        <tr key={b.buildingId} className="border-t hover:bg-muted/20">
                          <td className="px-4 py-2">{b.buildingName}</td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {formatAmount(b.buildingExpenses)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                            {b.sharedPortion > 0
                              ? formatAmount(b.sharedPortion)
                              : '—'}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums font-medium">
                            {formatAmount(b.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/40 font-semibold">
                        <td className="px-4 py-2">Total</td>
                        <td colSpan={2} />
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatAmount(report.totalTenant)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
