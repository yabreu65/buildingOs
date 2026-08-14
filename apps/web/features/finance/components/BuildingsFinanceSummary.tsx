'use client';

import { useState, useEffect, useRef } from 'react';
import { financeApi } from '../services/finance.api';
import { Skeleton } from '@/shared/components/ui';
import { Table, THead, TBody, TR, TH, TD } from '@/shared/components/ui/Table';
import { formatCurrencyBuckets } from '@/shared/lib/format/currency-buckets';
import type { CurrencyAmountBucket, CollectionRateBucket } from '../services/finance.api';

interface BuildingFinanceSummary {
  buildingId: string;
  buildingName: string;
  totalChargesByCurrency: CurrencyAmountBucket[] | null;
  totalPaidByCurrency: CurrencyAmountBucket[] | null;
  totalOutstandingByCurrency: CurrencyAmountBucket[] | null;
  collectionRateByCurrency: CollectionRateBucket[] | null;
  errorMessage?: string;
}

interface BuildingsFinanceSummaryProps {
  tenantId: string;
  period?: string;
  buildingIds: string[];
  buildingNames: Record<string, string>;
}



export function BuildingsFinanceSummary({
  buildingIds,
  buildingNames,
  period,
}: BuildingsFinanceSummaryProps) {
  const [summaries, setSummaries] = useState<BuildingFinanceSummary[]>([]);
  const [loading, setLoading] = useState(buildingIds.length > 0);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);
  const failedCount = summaries.filter((summary) => summary.errorMessage).length;

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    let cancelled = false;

    const fetchSummaries = async () => {
      try {
        setLoading(true);
        const results = await Promise.all(
          buildingIds.map(async (bId) => {
            try {
              const summary = await financeApi.getFinancialSummary(bId, period);
              return {
                buildingId: bId,
                buildingName: buildingNames[bId] || bId,
                totalChargesByCurrency: summary.totalChargesByCurrency,
                totalPaidByCurrency: summary.totalPaidByCurrency,
                totalOutstandingByCurrency: summary.totalOutstandingByCurrency,
                collectionRateByCurrency: summary.totalChargesByCurrency.map((bucket) => {
                  const paid = summary.totalPaidByCurrency.find((b) => b.currency === bucket.currency);
                  return {
                    currency: bucket.currency,
                    rate:
                      bucket.amountMinor > 0
                        ? (paid?.amountMinor ?? 0) / bucket.amountMinor
                        : 0,
                  };
                }),
              };
            } catch {
              return {
                buildingId: bId,
                buildingName: buildingNames[bId] || bId,
                totalChargesByCurrency: null,
                totalPaidByCurrency: null,
                totalOutstandingByCurrency: null,
                collectionRateByCurrency: null,
                errorMessage: 'No disponible',
              };
            }
          }),
        );

        if (cancelled || requestId !== requestIdRef.current) {
          return;
        }

        setSummaries(results);
        setError(null);
      } catch (err) {
        if (cancelled || requestId !== requestIdRef.current) {
          return;
        }

        setError(err instanceof Error ? err : new Error('Failed to fetch summaries'));
        setSummaries([]);
      } finally {
        if (cancelled || requestId !== requestIdRef.current) {
          return;
        }

        setLoading(false);
      }
    };

    if (buildingIds.length > 0) {
      fetchSummaries();
    }

    return () => {
      cancelled = true;
    };
  }, [buildingIds, buildingNames, period]);

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

  const formatBuckets = (value: CurrencyAmountBucket[] | null) =>
    value === null ? '—' : formatCurrencyBuckets(value);

  const formatRates = (value: CollectionRateBucket[] | null) =>
    value === null
      ? '—'
      : value.map((r) => `${Math.round(r.rate * 100)}% ${r.currency}`).join(' · ');
  return (
    <div className="space-y-6">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-gray-800">Rendimiento por edificio</h2>
        <p className="text-sm text-gray-500 mt-1">
          Vista comparativa de la eficiencia de cobranza entre todos los edificios del tenant
        </p>
      </div>
      {failedCount > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No pudimos cargar {failedCount} edificio{failedCount !== 1 ? 's' : ''}. Esos valores se muestran como “—” para no ocultar el error.
        </div>
      )}
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
                  {formatBuckets(summary.totalChargesByCurrency)}
                </TD>
                <TD className="px-6 py-4 text-right text-sm font-medium text-green-600">
                  {formatBuckets(summary.totalPaidByCurrency)}
                </TD>
                <TD className="px-6 py-4 text-right text-sm font-medium text-red-600">
                  {formatBuckets(summary.totalOutstandingByCurrency)}
                </TD>
                <TD className="px-6 py-4 text-right text-sm font-medium">
                  {formatRates(summary.collectionRateByCurrency)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}
