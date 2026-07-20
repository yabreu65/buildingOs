'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Button from '@/shared/components/ui/Button';
import Card from '@/shared/components/ui/Card';
import EmptyState from '@/shared/components/ui/EmptyState';
import Skeleton from '@/shared/components/ui/Skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/shared/components/ui/Table';
import { formatCurrency } from '@/shared/lib/format/money';
import { useBuildingDelinquency } from '../hooks/useBuildingDelinquency';
import {
  type BuildingDelinquencyAging,
  type BuildingDelinquencySortBy,
  type BuildingDelinquencySortOrder,
} from '../services/finance.api';

interface BuildingDelinquencyListProps {
  tenantId: string;
  buildingId: string;
  period: string;
}

const PAGE_SIZES = [25, 50, 100] as const;

function getMonthLabel(period: string): string {
  const label = new Intl.DateTimeFormat('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${period}-01T00:00:00.000Z`));

  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getPositiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function BuildingDelinquencyList({
  tenantId,
  buildingId,
  period,
}: BuildingDelinquencyListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const page = getPositiveInteger(searchParams.get('delinquencyPage'), 1);
  const requestedPageSize = getPositiveInteger(searchParams.get('delinquencyPageSize'), 25);
  const pageSize = PAGE_SIZES.includes(requestedPageSize as (typeof PAGE_SIZES)[number])
    ? requestedPageSize
    : 25;
  const search = searchParams.get('delinquencySearch') ?? '';
  const aging = (searchParams.get('delinquencyAging') ?? 'ALL') as BuildingDelinquencyAging;
  const sortBy = (searchParams.get('delinquencySortBy') ?? 'ACCUMULATED_DEBT') as BuildingDelinquencySortBy;
  const sortOrder = (searchParams.get('delinquencySortOrder') ?? 'desc') as BuildingDelinquencySortOrder;
  const { data, isPending, isError, error, refetch } = useBuildingDelinquency(buildingId, {
    period,
    page,
    pageSize,
    search: search || undefined,
    aging,
    sortBy,
    sortOrder,
  });

  const updateQuery = (updates: Record<string, string | undefined>) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === '') {
        nextParams.delete(key);
      } else {
        nextParams.set(key, value);
      }
    }

    const nextQuery = nextParams.toString();
    if (nextQuery === searchParams.toString()) return;
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  };

  const resetPage = (updates: Record<string, string | undefined>) => {
    updateQuery({ ...updates, delinquencyPage: undefined });
  };

  if (isPending) {
    return (
      <Card className="space-y-4 p-4" aria-live="polite">
        <p className="text-sm text-muted-foreground">Cargando unidades morosas…</p>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="border-red-200 bg-red-50 p-4">
        <p className="font-medium text-red-900">No pudimos cargar la morosidad. Intenta nuevamente.</p>
        <p className="mt-1 text-sm text-red-700">
          {error instanceof Error ? error.message : 'Error al cargar la morosidad'}
        </p>
        <Button className="mt-3" size="sm" variant="secondary" onClick={() => refetch()}>
          Reintentar
        </Button>
      </Card>
    );
  }

  const firstResult = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const lastResult = data ? Math.min(data.page * data.pageSize, data.total) : 0;
  const hasFilters = Boolean(search) || aging !== 'ALL';

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Morosidad de {getMonthLabel(period)}</h2>
        <p className="text-sm text-muted-foreground">
          {data?.total ?? 0} unidades con cargos pendientes en el período.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Pendiente del período</p>
          <p className="mt-1 text-xl font-semibold text-orange-600">
            {formatCurrency(data?.totals.periodDebt ?? 0, data?.currency ?? 'ARS')}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Deuda acumulada hasta {getMonthLabel(period)}</p>
          <p className="mt-1 text-xl font-semibold text-red-600">
            {formatCurrency(data?.totals.accumulatedDebt ?? 0, data?.currency ?? 'ARS')}
          </p>
        </Card>
      </div>

      <Card className="space-y-4 p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_220px_160px]">
          <label className="space-y-1">
            <span className="text-sm font-medium">Buscar</span>
            <input
              aria-label="Buscar por unidad o responsable"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Buscar por unidad o responsable"
              value={search}
              onChange={(event) => resetPage({ delinquencySearch: event.target.value || undefined })}
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">Antigüedad</span>
            <select
              aria-label="Filtrar por períodos vencidos"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={aging}
              onChange={(event) => resetPage({ delinquencyAging: event.target.value === 'ALL' ? undefined : event.target.value })}
            >
              <option value="ALL">Todos</option>
              <option value="ONE_PERIOD">1 período vencido</option>
              <option value="TWO_TO_THREE_PERIODS">2 a 3 períodos vencidos</option>
              <option value="MORE_THAN_THREE_PERIODS">Más de 3 períodos vencidos</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">Ordenar por</span>
            <select
              aria-label="Ordenar morosidad"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={`${sortBy}:${sortOrder}`}
              onChange={(event) => {
                const [nextSortBy, nextSortOrder] = event.target.value.split(':');
                resetPage({
                  delinquencySortBy: nextSortBy,
                  delinquencySortOrder: nextSortOrder,
                });
              }}
            >
              <option value="ACCUMULATED_DEBT:desc">Mayor deuda acumulada</option>
              <option value="PERIOD_DEBT:desc">Mayor deuda del período</option>
              <option value="OVERDUE_PERIODS:desc">Más períodos vencidos</option>
              <option value="UNIT:asc">Unidad ascendente</option>
              <option value="UNIT:desc">Unidad descendente</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">Por página</span>
            <select
              aria-label="Resultados por página"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={pageSize}
              onChange={(event) => resetPage({ delinquencyPageSize: event.target.value })}
            >
              {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        </div>

        {!data || data.total === 0 ? (
          <EmptyState
            title={hasFilters ? 'No encontramos unidades que coincidan con los filtros aplicados.' : `No hay unidades con saldo pendiente en ${getMonthLabel(period)}.`}
            description={hasFilters ? 'Ajusta la búsqueda o los filtros para continuar.' : 'Todas las unidades están al día para el período seleccionado.'}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Unidad</TH>
                    <TH>Responsable</TH>
                    <TH className="text-right">Deuda del período</TH>
                    <TH className="text-right">Deuda acumulada</TH>
                    <TH className="text-right">Períodos vencidos</TH>
                    <TH className="text-right">Acción</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.items.map((item) => (
                    <TR key={item.unitId}>
                      <TD className="font-medium">{item.unitLabel}</TD>
                      <TD>{item.responsibleName ?? 'Sin responsable asignado'}</TD>
                      <TD className="text-right text-orange-600">{formatCurrency(item.periodDebt, data.currency)}</TD>
                      <TD className="text-right font-semibold text-red-600">{formatCurrency(item.accumulatedDebt, data.currency)}</TD>
                      <TD className="text-right">{item.overduePeriods}</TD>
                      <TD className="text-right">
                        <Button
                          aria-label={`Ver cuenta de ${item.unitLabel}`}
                          size="sm"
                          variant="secondary"
                          onClick={() => router.push(`/${tenantId}/buildings/${buildingId}/units/${item.unitId}?tab=finance`)}
                        >
                          Ver cuenta
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            <div className="flex flex-col gap-3 border-t pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
              <p>Mostrando {firstResult}–{lastResult} de {data.total} unidades</p>
              <div className="flex items-center gap-2">
                <Button
                  aria-label="Página anterior"
                  size="sm"
                  variant="secondary"
                  disabled={data.page <= 1}
                  onClick={() => updateQuery({ delinquencyPage: String(data.page - 1) })}
                >
                  Anterior
                </Button>
                <span>Página {data.page} de {data.totalPages}</span>
                <Button
                  aria-label="Página siguiente"
                  size="sm"
                  variant="secondary"
                  disabled={data.page >= data.totalPages}
                  onClick={() => updateQuery({ delinquencyPage: String(data.page + 1) })}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
