'use client';

import { useState, useEffect } from 'react';
import { financeApi } from '../../services/finance.api';
import { Skeleton, ErrorState } from '@/shared/components/ui';
import { Table, THead, TBody, TR, TH, TD } from '@/shared/components/ui/Table';

interface BuildingFinanceSummary {
  buildingId: string;
  buildingName: string;
  totalCharges: number;
  totalPaid: number;
  totalOutstanding: number;
  collectionRate: number;
}

interface BuildingsFinanceSummaryProps {
  tenantId: string;
  buildingIds: string[];
  buildingNames: Record<string, string>;
}

const formatARS = (cents: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(cents / 100);

const formatPercentage = (val: number) => `${Math.round(val)}%`;

export function BuildingsFinanceSummary({
  tenantId,
  buildingIds,
  buildingNames,
}: BuildingsFinanceSummaryProps) {
  const [summaries, setSummaries] = useState<BuildingFinanceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchSummaries = async () => {
      try {
        setLoading(true);
        const results = await Promise.all(
          buildingIds.map(async (bId) => {
            try {
              const summary = await financeApi.getFinancialSummary(bId);
              return {
                buildingId: bId,
                buildingName: buildingNames[bId] || bId,
                totalCharges: summary.totalCharges,
                totalPaid: summary.totalPaid,
                totalOutstanding: summary.totalOutstanding,
                collectionRate:
                  summary.totalCharges > 0
                    ? (summary.totalPaid / summary.totalCharges) * 100
                    : 0,
              };
            } catch {
              return {
                buildingId: bId,
                buildingName: buildingNames[bId] || bId,
                totalCharges: 0,
                totalPaid: 0,
                totalOutstanding: 0,
                collectionRate: 0,
              };
            }
          }),
        );
        setSummaries(results);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch summaries'));
        setSummaries([]);
      } finally {
        setLoading(false);
      }
    };

    if (buildingIds.length > 0) {
      fetchSummaries();
    }
  }, [buildingIds, buildingNames]);

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState message={error.message} />
    );
  }

  if (summaries.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center">
        <p className="text-gray-600">No hay edificios para mostrar</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <Table>
        <THead>
          <TR>
            <TH>Edificio</TH>
            <TH className="text-right">Cargos totales</TH>
            <TH className="text-right">Pagado</TH>
            <TH className="text-right">Pendiente</TH>
            <TH className="text-right">Cobranza</TH>
          </TR>
        </THead>
        <TBody>
          {summaries.map((summary) => (
            <TR key={summary.buildingId}>
              <TD className="font-medium">{summary.buildingName}</TD>
              <TD className="text-right">{formatARS(summary.totalCharges)}</TD>
              <TD className="text-right text-green-600">
                {formatARS(summary.totalPaid)}
              </TD>
              <TD className="text-right text-red-600">
                {formatARS(summary.totalOutstanding)}
              </TD>
              <TD className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <div className="w-20 h-2 rounded-full bg-gray-200">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{
                        width: `${Math.min(summary.collectionRate, 100)}%`,
                      }}
                    />
                  </div>
                  <span className="font-semibold text-sm w-12 text-right">
                    {formatPercentage(summary.collectionRate)}
                  </span>
                </div>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
