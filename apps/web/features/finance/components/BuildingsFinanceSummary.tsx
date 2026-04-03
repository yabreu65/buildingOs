'use client';

import { useState, useEffect } from 'react';
import { financeApi } from '../services/finance.api';
import { Skeleton, ErrorState } from '@/shared/components/ui';
import { Table, THead, TBody, TR, TH, TD } from '@/shared/components/ui/Table';
import { useTenantCurrency } from '@/features/tenancy/hooks/useTenantBranding';

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

const formatPercentage = (val: number) => `${Math.round(val)}%`;

export function BuildingsFinanceSummary({
  tenantId,
  buildingIds,
  buildingNames,
}: BuildingsFinanceSummaryProps) {
  const { format } = useTenantCurrency();
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
      <div className="space-y-4">
        <div className="text-center py-8">
          <Skeleton className="h-10 w-56 mx-auto" />
          <Skeleton className="h-10 w-48 mx-auto mt-2" />
          <Skeleton className="h-10 w-40 mx-auto mt-2" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6">
        <p className="text-red-700">Error al cargar datos: {error.message}</p>
      </div>
    );
  }

  if (summaries.length === 0) {
    return (
      <div className="bg-gray-50 border-l-4 border-gray-300 p-4 mb-6">
        <p className="text-gray-600">No hay edificios para mostrar</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-gray-800">Rendimiento por edificio</h2>
        <p className="text-sm text-gray-500 mt-1">
          Vista comparativa de la eficiencia de cobranza entre todos los edificios del tenant
        </p>
      </div>
      <div className="overflow-x-auto">
        <Table className="min-w-full divide-y divide-gray-200">
          <THead className="bg-gray-50">
            <TR>
              <TH className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Edificio
              </TH>
              <TH className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Cargos totales
              </TH>
              <TH className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Pagado
              </TH>
              <TH className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Pendiente
              </TH>
              <TH className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Cobranza
              </TH>
            </TR>
          </THead>
          <TBody className="bg-white divide-y divide-gray-200">
            {summaries.map((summary, index) => (
              <TR key={summary.buildingId} className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-gray-100`}>
                <TD className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">
                  {summary.buildingName}
                </TD>
                <TD className="px-6 py-4 text-right text-sm font-medium text-gray-900">
                  {format(summary.totalCharges)}
                </TD>
                <TD className="px-6 py-4 text-right text-sm font-medium text-green-600">
                  {format(summary.totalPaid)}
                </TD>
                <TD className="px-6 py-4 text-right text-sm font-medium text-red-600">
                  {format(summary.totalOutstanding)}
                </TD>
                <TD className="px-6 py-4 text-right text-sm font-medium">
                  <div className="flex items-center">
                    <div className="relative w-24 h-2.5 bg-gray-200 rounded-full">
                      <div
                        className="absolute left-0 h-full rounded-full bg-blue-600"
                        style={{
                          width: `${Math.min(summary.collectionRate, 100)}%`,
                        }}
                      />
                    </div>
                    <span className="ml-2 text-xs font-semibold text-gray-900">
                      {formatPercentage(summary.collectionRate)}
                    </span>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}
