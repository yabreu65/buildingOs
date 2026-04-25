'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Card from '@/shared/components/ui/Card';
import Skeleton from '@/shared/components/ui/Skeleton';
import OnboardingChecklist from '@/features/onboarding/OnboardingChecklist';
import { useContextAware } from '@/features/buildings/hooks/useContextAware';
import { useAuthSession, useIsSuperAdmin } from '@/features/auth/useAuthSession';
import { useEffectiveRole } from '@/features/tenancy/hooks/useEffectiveRole';
import {
  useDashboardSummary,
  useBuildingList,
  useDebtAging,
  useDebtByPeriod,
} from '@/features/dashboard/hooks/useDashboardSummary';
import { Table, THead, TBody, TR, TH, TD } from '@/shared/components/ui/Table';
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Info,
  Percent,
  RotateCcw,
  X,
} from 'lucide-react';
import {
  buildMorosidadFilterChips,
  filterMorosidadByPeriodRows,
  filterMorosidadRows,
  type MorosidadFilterState,
} from '@/features/dashboard/utils/morosidad-filters';

const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';

const formatARS = (cents: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format((cents || 0) / 100);

const formatCollectionRate = (value: number | null | undefined) => {
  if (value == null) return '-';
  return `${Math.round(value * 100)}%`;
};

const formatDisplayDate = (value: string | null | undefined) => {
  if (!value) return '-';

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('es-AR').format(parsed);
};

const formatPeriodMonth = (period: string) => {
  const [year, month] = period.split('-');
  if (!year || !month) return period;
  return `${month}/${year}`;
};

const getTodayInTimezone = (timezone: string) => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
};

const getCurrentMonthInTimezone = (timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;

  if (!year || !month) {
    return new Date().toISOString().slice(0, 7);
  }

  return `${year}-${month}`;
};

const bucketLabels = {
  '0_30': '0–30 días',
  '31_60': '31–60 días',
  '61_90': '61–90 días',
  '90_plus': '90+ días',
} as const;

const TooltipLabel = ({ text }: { text: string }) => (
  <span className="inline-flex items-center text-gray-400" title={text} aria-label={text}>
    <Info className="h-4 w-4" />
  </span>
);

interface KPICardProps {
  title: string;
  subtitle: string;
  value: string;
  footer?: string;
  cta?: string;
  onClick?: () => void;
  tooltip?: string;
  icon?: ReactNode;
}

const KPICard = ({
  title,
  subtitle,
  value,
  footer,
  cta,
  onClick,
  tooltip,
  icon,
}: KPICardProps) => {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold">{title}</h3>
            {tooltip ? <TooltipLabel text={tooltip} /> : null}
          </div>
          <p className="text-xs text-gray-500">{subtitle}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {footer ? <p className="text-xs text-gray-600">{footer}</p> : null}
        </div>
        {icon ? <div className="rounded-lg bg-gray-100 p-2">{icon}</div> : null}
      </div>
      {cta && onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="mt-3 text-sm font-medium text-blue-600 hover:underline"
        >
          {cta}
        </button>
      ) : null}
    </Card>
  );
};

const EmptyMorosityState = ({ asOf }: { asOf: string }) => (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    <CheckCircle className="mb-2 h-10 w-10 text-green-600" />
    <h4 className="text-lg font-semibold">Sin morosidad</h4>
    <p className="text-sm text-gray-600">
      No hay cargos vencidos con saldo pendiente al {asOf}.
    </p>
  </div>
);

interface AdminDashboardProps {
  tenantId: string;
}

const AdminDashboard = ({ tenantId }: AdminDashboardProps) => {
  const router = useRouter();
  const tableRef = useRef<HTMLDivElement | null>(null);

  const [buildingFilter, setBuildingFilter] = useState<string | undefined>();
  const [asOf, setAsOf] = useState<string>(() => getTodayInTimezone(DEFAULT_TIMEZONE));
  const [periodMonth, setPeriodMonth] = useState<string>(() =>
    getCurrentMonthInTimezone(DEFAULT_TIMEZONE),
  );

  const [viewMode, setViewMode] = useState<'months' | 'aging'>('months');
  const [isAgingAccordionOpen, setIsAgingAccordionOpen] = useState(false);
  const [expandedUnits, setExpandedUnits] = useState<Record<string, boolean>>({});

  // Filters for months view
  const [monthsMinimumDebtArs, setMonthsMinimumDebtArs] = useState<string>('');
  const [monthsWithoutResponsible, setMonthsWithoutResponsible] = useState(false);
  const [monthsSearch, setMonthsSearch] = useState('');

  // Filters for aging view
  const [agingOnly90Plus, setAgingOnly90Plus] = useState(false);
  const [agingMinimumDebtArs, setAgingMinimumDebtArs] = useState<string>('');
  const [agingWithoutResponsible, setAgingWithoutResponsible] = useState(false);
  const [agingSearch, setAgingSearch] = useState('');

  const {
    data: dashboardSummary,
    isPending: dashboardLoading,
    error: dashboardError,
  } = useDashboardSummary(tenantId, {
    buildingId: buildingFilter,
    periodMonth,
  });

  const {
    data: debtAging,
    isPending: debtAgingLoading,
    error: debtAgingError,
    refetch: refetchDebtAging,
  } = useDebtAging(tenantId, {
    asOf,
    buildingId: buildingFilter,
  });

  const {
    data: debtByPeriod,
    isPending: debtByPeriodLoading,
    error: debtByPeriodError,
    refetch: refetchDebtByPeriod,
  } = useDebtByPeriod(tenantId, {
    asOf,
    buildingId: buildingFilter,
  });

  const { data: buildings } = useBuildingList(tenantId);

  const buildingOptions = useMemo(() => {
    return [{ id: '', name: 'Todos los edificios' }, ...(buildings || [])];
  }, [buildings]);

  const dashboardErrorMessage = dashboardError
    ? dashboardError instanceof Error
      ? dashboardError.message
      : String(dashboardError)
    : null;

  const debtAgingErrorMessage = debtAgingError
    ? debtAgingError instanceof Error
      ? debtAgingError.message
      : String(debtAgingError)
    : null;

  const debtByPeriodErrorMessage = debtByPeriodError
    ? debtByPeriodError instanceof Error
      ? debtByPeriodError.message
      : String(debtByPeriodError)
    : null;

  const periodSubtitle = `Período: ${periodMonth}`;
  const kpis = dashboardSummary?.kpis;
  const grossPeriodCharges = (kpis?.outstandingAmount || 0) + (kpis?.collectedAmount || 0);

  const resolvedAsOf = debtByPeriod?.asOf || debtAging?.asOf || asOf;

  const monthFilters: MorosidadFilterState = {
    only90Plus: false,
    minimumDebtArs: monthsMinimumDebtArs,
    withoutResponsible: monthsWithoutResponsible,
    search: monthsSearch,
    asOf: resolvedAsOf,
  };

  const monthFilterChips = useMemo(
    () => buildMorosidadFilterChips(monthFilters),
    [monthsMinimumDebtArs, monthsWithoutResponsible, monthsSearch, resolvedAsOf],
  );

  const agingFilters: MorosidadFilterState = {
    only90Plus: agingOnly90Plus,
    minimumDebtArs: agingMinimumDebtArs,
    withoutResponsible: agingWithoutResponsible,
    search: agingSearch,
    asOf: resolvedAsOf,
  };

  const agingFilterChips = useMemo(
    () => buildMorosidadFilterChips(agingFilters),
    [agingOnly90Plus, agingMinimumDebtArs, agingWithoutResponsible, agingSearch, resolvedAsOf],
  );

  const filteredMonthRows = useMemo(
    () =>
      filterMorosidadByPeriodRows(debtByPeriod?.rowsByUnit || [], {
        minimumDebtArs: monthsMinimumDebtArs,
        withoutResponsible: monthsWithoutResponsible,
        search: monthsSearch,
      }),
    [debtByPeriod?.rowsByUnit, monthsMinimumDebtArs, monthsWithoutResponsible, monthsSearch],
  );

  const filteredAgingRows = useMemo(
    () => filterMorosidadRows(debtAging?.rowsByUnit || [], agingFilters),
    [debtAging?.rowsByUnit, agingOnly90Plus, agingMinimumDebtArs, agingWithoutResponsible, agingSearch, resolvedAsOf],
  );

  const scrollToMorosity = () => {
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const navigateToUnitAccount = (unitId?: string) => {
    const query = unitId ? `?unitId=${encodeURIComponent(unitId)}` : '';
    router.push(`/${tenantId}/units${query}`);
  };

  const toggleRowExpansion = (unitId: string) => {
    setExpandedUnits((prev) => ({
      ...prev,
      [unitId]: !prev[unitId],
    }));
  };

  const clearMonthsFilters = () => {
    setMonthsMinimumDebtArs('');
    setMonthsWithoutResponsible(false);
    setMonthsSearch('');
  };

  const clearAgingFilters = () => {
    setAgingOnly90Plus(false);
    setAgingMinimumDebtArs('');
    setAgingWithoutResponsible(false);
    setAgingSearch('');
  };

  const clearMonthsChip = (key: string) => {
    if (key === 'minDebt') {
      setMonthsMinimumDebtArs('');
      return;
    }
    if (key === 'noOwner') {
      setMonthsWithoutResponsible(false);
      return;
    }
    if (key === 'search') {
      setMonthsSearch('');
    }
  };

  const clearAgingChip = (key: string) => {
    if (key === 'only90') {
      setAgingOnly90Plus(false);
      return;
    }
    if (key === 'minDebt') {
      setAgingMinimumDebtArs('');
      return;
    }
    if (key === 'noOwner') {
      setAgingWithoutResponsible(false);
      return;
    }
    if (key === 'search') {
      setAgingSearch('');
    }
  };

  const renderDebtCards = () => {
    if (debtAgingLoading) {
      return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      );
    }

    if (debtAgingErrorMessage) {
      return (
        <Card className="border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">No se pudo cargar la foto de deuda: {debtAgingErrorMessage}</p>
        </Card>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <KPICard
          title="Deuda vencida total"
          subtitle={`Al ${debtAging?.asOf || asOf} • Solo cargos vencidos con saldo pendiente`}
          value={formatARS(debtAging?.totalOverdue || 0)}
          footer={`Unidades morosas: ${debtAging?.unitsMorosas || 0}`}
          cta="Ver morosidad"
          onClick={scrollToMorosity}
          tooltip="Incluye cargos con vencimiento anterior al corte y saldo > 0. No incluye el mes en curso si aún no está vencido."
          icon={<DollarSign className="h-5 w-5 text-orange-600" />}
        />

        <Card className="p-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold">Antigüedad de la deuda</h3>
              <TooltipLabel text="Los buckets se calculan según la diferencia entre el corte y la fecha de vencimiento de cada cargo." />
            </div>
            <p className="text-xs text-gray-500">Distribución por días de atraso</p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {(Object.keys(bucketLabels) as Array<keyof typeof bucketLabels>).map((bucket) => (
              <div key={bucket} className="rounded-md border border-gray-200 p-2">
                <p className="text-xs text-gray-500">{bucketLabels[bucket]}</p>
                <p className="text-sm font-semibold">{formatARS(debtAging?.buckets?.[bucket] || 0)}</p>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={scrollToMorosity}
            className="mt-3 text-sm font-medium text-blue-600 hover:underline"
          >
            Ver detalle
          </button>
        </Card>

        <KPICard
          title="Mora más antigua"
          subtitle="Período vencido más antiguo con saldo"
          value={
            debtAging?.worstCase
              ? `Desde ${debtAging.worstCase.period} • ${debtAging.worstCase.unitLabel}`
              : '-'
          }
          footer={
            debtAging?.worstCase
              ? `Vence: ${formatDisplayDate(debtAging.worstCase.dueDate)} • Saldo: ${formatARS(
                  debtAging.worstCase.outstanding,
                )}`
              : `Vence: - • Saldo: ${formatARS(0)}`
          }
          cta="Ver cuenta"
          onClick={() => navigateToUnitAccount(debtAging?.worstCase?.unitId)}
          tooltip="Ayuda a detectar casos crónicos de morosidad."
          icon={<AlertCircle className="h-5 w-5 text-red-600" />}
        />
      </div>
    );
  };

  if (dashboardLoading && !dashboardSummary) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard Admin</h1>
        <p className="text-gray-600">Resumen financiero profesional</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            Edificio
            <TooltipLabel text="Filtra métricas y morosidad por edificio." />
          </label>
          <select
            value={buildingFilter || ''}
            onChange={(event) => setBuildingFilter(event.target.value || undefined)}
            className="w-full rounded-md border px-3 py-2 text-sm"
          >
            {buildingOptions.map((building) => (
              <option key={building.id} value={building.id}>
                {building.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            Corte de deuda
            <TooltipLabel text="La deuda vencida se calcula con cargos cuyo vencimiento es anterior al corte." />
          </label>
          <input
            type="date"
            value={asOf}
            onChange={(event) => setAsOf(event.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            Período contable
            <TooltipLabel text="Afecta cargos y KPIs del período. No cambia la deuda vencida total." />
          </label>
          <input
            type="month"
            value={periodMonth}
            onChange={(event) => setPeriodMonth(event.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>
      </div>

      {dashboardErrorMessage ? (
        <Card className="border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">
            No se pudo cargar el resumen del período: {dashboardErrorMessage}
          </p>
        </Card>
      ) : null}

      {renderDebtCards()}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <KPICard
          title="Saldo pendiente del período"
          subtitle={`${periodSubtitle} • Cargos del período menos pagos imputados`}
          value={formatARS(kpis?.outstandingAmount || 0)}
          cta="Ver detalle"
          onClick={() => router.push(`/${tenantId}/finanzas`)}
          tooltip="Esto NO es la deuda vencida total. Es el saldo del período contable seleccionado."
          icon={<DollarSign className="h-5 w-5 text-orange-600" />}
        />

        <KPICard
          title="Cobrado en el período"
          subtitle={`${periodSubtitle} • Según fecha de pago (paidAt)`}
          value={formatARS(kpis?.collectedAmount || 0)}
          footer={`de ${formatARS(grossPeriodCharges)}`}
          cta="Ver cobros"
          onClick={() => router.push(`/${tenantId}/finanzas`)}
          tooltip="Suma pagos aprobados/conciliados con paidAt dentro del período."
          icon={<DollarSign className="h-5 w-5 text-green-600" />}
        />

        <KPICard
          title="Tasa de cobranza"
          subtitle={periodSubtitle}
          value={formatCollectionRate(kpis?.collectionRate)}
          tooltip="Cobrado del período / Cargos del período."
          icon={<Percent className="h-5 w-5 text-blue-600" />}
        />
      </div>

      <div ref={tableRef}>
        <Card className="p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-lg font-semibold">Morosidad por unidad</h3>
              <p className="text-sm text-gray-500">
                Cargos vencidos con saldo pendiente (al {resolvedAsOf})
              </p>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-gray-700">Vista</span>
            <div className="inline-flex rounded-md border border-gray-300 p-1">
              <button
                type="button"
                onClick={() => setViewMode('months')}
                className={`rounded px-3 py-1 text-sm ${
                  viewMode === 'months' ? 'bg-gray-900 text-white' : 'text-gray-700'
                }`}
              >
                Por meses
              </button>
              <button
                type="button"
                onClick={() => setViewMode('aging')}
                className={`rounded px-3 py-1 text-sm ${
                  viewMode === 'aging' ? 'bg-gray-900 text-white' : 'text-gray-700'
                }`}
              >
                Por antigüedad
              </button>
            </div>
          </div>

          {viewMode === 'months' ? (
            <>
              <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div className="text-sm">
                  <label htmlFor="months-minimum-debt" className="mb-1 block text-gray-700">
                    Deuda mínima
                  </label>
                  <input
                    id="months-minimum-debt"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder="Ej: 5000"
                    value={monthsMinimumDebtArs}
                    onChange={(event) => setMonthsMinimumDebtArs(event.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Muestra solo unidades con deuda vencida mayor o igual al monto.
                  </p>
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <label htmlFor="months-without-owner" className="flex cursor-pointer items-center gap-2">
                    <input
                      id="months-without-owner"
                      type="checkbox"
                      checked={monthsWithoutResponsible}
                      onChange={(event) => setMonthsWithoutResponsible(event.target.checked)}
                    />
                    <span>Sin responsable</span>
                  </label>
                </div>

                <div className="text-sm">
                  <label htmlFor="months-search" className="mb-1 block text-gray-700">
                    Buscar
                  </label>
                  <input
                    id="months-search"
                    type="text"
                    placeholder="Buscar unidad o responsable..."
                    value={monthsSearch}
                    onChange={(event) => setMonthsSearch(event.target.value)}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {monthFilterChips.length > 0 ? (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {monthFilterChips.map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      onClick={() => clearMonthsChip(chip.key)}
                      className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-50 px-3 py-1 text-xs text-gray-700 hover:bg-gray-100"
                    >
                      <span>{chip.label}</span>
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              ) : null}

              {monthFilterChips.length > 0 ? (
                <div className="mb-4">
                  <button
                    type="button"
                    onClick={clearMonthsFilters}
                    className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Limpiar filtros
                  </button>
                </div>
              ) : null}

              {debtByPeriodLoading ? (
                <div className="space-y-3">
                  {monthFilterChips.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      <Skeleton className="h-7 w-28 rounded-full" />
                      <Skeleton className="h-7 w-32 rounded-full" />
                    </div>
                  ) : null}
                  <Skeleton className="h-52" />
                </div>
              ) : debtByPeriodErrorMessage ? (
                <Card className="border-red-200 bg-red-50 p-4">
                  <p className="text-sm text-red-700">
                    No se pudo cargar la morosidad por períodos: {debtByPeriodErrorMessage}
                  </p>
                  <button
                    type="button"
                    onClick={() => void refetchDebtByPeriod()}
                    className="mt-3 inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
                  >
                    Reintentar
                  </button>
                </Card>
              ) : filteredMonthRows.length === 0 ? (
                <EmptyMorosityState asOf={resolvedAsOf} />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Unidad</TH>
                      <TH>Responsable</TH>
                      <TH className="text-right">Total vencido</TH>
                      <TH>Meses impagos</TH>
                      <TH>Mes más antiguo impago</TH>
                      <TH>Último pago</TH>
                      <TH>Acciones</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filteredMonthRows.map((row) => {
                      const periods = row.periods.map((periodItem) => formatPeriodMonth(periodItem.period));
                      const visiblePeriods = periods.slice(0, 3);
                      const hiddenPeriods = periods.slice(3);
                      const isExpanded = !!expandedUnits[row.unitId];

                      return (
                        <Fragment key={row.unitId}>
                          <TR key={row.unitId}>
                            <TD className="font-medium">{row.unitLabel}</TD>
                            <TD>
                              {row.responsable
                                ? `${row.responsable.name} (${row.responsable.role})`
                                : '-'}
                            </TD>
                            <TD className="text-right font-semibold text-orange-600">
                              {formatARS(row.totalOverdue)}
                            </TD>
                            <TD>
                              <div className="flex items-center gap-2 text-xs">
                                <span>{visiblePeriods.join(' • ')}</span>
                                {hiddenPeriods.length > 0 ? (
                                  <span
                                    className="rounded-full border border-gray-300 px-2 py-0.5"
                                    title={hiddenPeriods.join(' • ')}
                                  >
                                    +{hiddenPeriods.length}
                                  </span>
                                ) : null}
                              </div>
                            </TD>
                            <TD>
                              {formatPeriodMonth(row.oldestUnpaidPeriod)} ({formatDisplayDate(row.oldestUnpaidDueDate)})
                            </TD>
                            <TD>{formatDisplayDate(row.lastPaymentDate)}</TD>
                            <TD>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => toggleRowExpansion(row.unitId)}
                                  className="text-xs text-blue-600 hover:underline"
                                >
                                  Ver detalle
                                </button>
                                <button
                                  type="button"
                                  onClick={() => navigateToUnitAccount(row.unitId)}
                                  className="text-xs text-blue-600 hover:underline"
                                >
                                  Ver cuenta
                                </button>
                              </div>
                            </TD>
                          </TR>

                          {isExpanded ? (
                            <TR key={`${row.unitId}-details`}>
                              <td colSpan={7} className="px-4 py-3 align-middle">
                                <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                                  <Table>
                                    <THead>
                                      <TR>
                                        <TH>Periodo</TH>
                                        <TH>Vencimiento</TH>
                                        <TH className="text-right">Cargo</TH>
                                        <TH className="text-right">Pagado aplicado</TH>
                                        <TH className="text-right">Saldo</TH>
                                      </TR>
                                    </THead>
                                    <TBody>
                                      {row.periods.map((periodItem) => (
                                        <TR key={`${row.unitId}-${periodItem.period}`}>
                                          <TD>{formatPeriodMonth(periodItem.period)}</TD>
                                          <TD>{formatDisplayDate(periodItem.dueDate)}</TD>
                                          <TD className="text-right">{formatARS(periodItem.charged)}</TD>
                                          <TD className="text-right">{formatARS(periodItem.allocatedPaid)}</TD>
                                          <TD className="text-right font-semibold text-orange-600">
                                            {formatARS(periodItem.outstanding)}
                                          </TD>
                                        </TR>
                                      ))}
                                    </TBody>
                                  </Table>
                                </div>
                              </td>
                            </TR>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </TBody>
                </Table>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setIsAgingAccordionOpen((prev) => !prev)}
                className="flex w-full items-center justify-between rounded-md border border-gray-300 px-4 py-3 text-left"
                aria-expanded={isAgingAccordionOpen}
              >
                <span className="text-sm font-medium">Distribución por antigüedad (días)</span>
                {isAgingAccordionOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>

              {isAgingAccordionOpen ? (
                <div className="space-y-4 rounded-md border border-gray-200 p-4">
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    {(Object.keys(bucketLabels) as Array<keyof typeof bucketLabels>).map((bucket) => (
                      <div key={bucket} className="rounded-md border border-gray-200 p-2">
                        <p className="text-xs text-gray-500">{bucketLabels[bucket]}</p>
                        <p className="text-sm font-semibold">{formatARS(debtAging?.buckets?.[bucket] || 0)}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
                    <div className="flex items-center gap-2 text-sm">
                      <label htmlFor="aging-only90" className="flex cursor-pointer items-center gap-2">
                        <input
                          id="aging-only90"
                          type="checkbox"
                          checked={agingOnly90Plus}
                          onChange={(event) => setAgingOnly90Plus(event.target.checked)}
                        />
                        <span>Solo 90+ días</span>
                      </label>
                    </div>

                    <div className="text-sm">
                      <label htmlFor="aging-minimum-debt" className="mb-1 block text-gray-700">
                        Deuda mínima
                      </label>
                      <input
                        id="aging-minimum-debt"
                        type="number"
                        min={0}
                        inputMode="numeric"
                        placeholder="Ej: 5000"
                        value={agingMinimumDebtArs}
                        onChange={(event) => setAgingMinimumDebtArs(event.target.value)}
                        className="w-full rounded-md border px-3 py-2 text-sm"
                      />
                    </div>

                    <div className="flex items-center gap-2 text-sm">
                      <label htmlFor="aging-without-owner" className="flex cursor-pointer items-center gap-2">
                        <input
                          id="aging-without-owner"
                          type="checkbox"
                          checked={agingWithoutResponsible}
                          onChange={(event) => setAgingWithoutResponsible(event.target.checked)}
                        />
                        <span>Sin responsable</span>
                      </label>
                    </div>

                    <div className="text-sm">
                      <label htmlFor="aging-search" className="mb-1 block text-gray-700">
                        Buscar
                      </label>
                      <input
                        id="aging-search"
                        type="text"
                        placeholder="Buscar unidad o responsable..."
                        value={agingSearch}
                        onChange={(event) => setAgingSearch(event.target.value)}
                        className="w-full rounded-md border px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  {agingFilterChips.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {agingFilterChips.map((chip) => (
                        <button
                          key={chip.key}
                          type="button"
                          onClick={() => clearAgingChip(chip.key)}
                          className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-gray-50 px-3 py-1 text-xs text-gray-700 hover:bg-gray-100"
                        >
                          <span>{chip.label}</span>
                          <X className="h-3 w-3" />
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {agingFilterChips.length > 0 ? (
                    <button
                      type="button"
                      onClick={clearAgingFilters}
                      className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Limpiar filtros
                    </button>
                  ) : null}

                  {debtAgingLoading ? (
                    <div className="space-y-3">
                      {agingFilterChips.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          <Skeleton className="h-7 w-28 rounded-full" />
                          <Skeleton className="h-7 w-32 rounded-full" />
                        </div>
                      ) : null}
                      <Skeleton className="h-52" />
                    </div>
                  ) : debtAgingErrorMessage ? (
                    <Card className="border-red-200 bg-red-50 p-4">
                      <p className="text-sm text-red-700">
                        No se pudo cargar la morosidad por antigüedad: {debtAgingErrorMessage}
                      </p>
                      <button
                        type="button"
                        onClick={() => void refetchDebtAging()}
                        className="mt-3 inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
                      >
                        Reintentar
                      </button>
                    </Card>
                  ) : filteredAgingRows.length === 0 ? (
                    <EmptyMorosityState asOf={resolvedAsOf} />
                  ) : (
                    <Table>
                      <THead>
                        <TR>
                          <TH>Unidad</TH>
                          <TH>Responsable</TH>
                          <TH className="text-right">Deuda vencida</TH>
                          <TH>Antigüedad (bucket)</TH>
                          <TH>Vencimiento más antiguo</TH>
                          <TH>Último pago</TH>
                          <TH>Acciones</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {filteredAgingRows.map((row) => (
                          <TR key={row.unitId}>
                            <TD className="font-medium">{row.unitLabel}</TD>
                            <TD>
                              {row.responsable
                                ? `${row.responsable.name} (${row.responsable.role})`
                                : '-'}
                            </TD>
                            <TD className="text-right font-semibold text-orange-600">
                              {formatARS(row.overdueTotal)}
                            </TD>
                            <TD>{bucketLabels[row.bucket]}</TD>
                            <TD>
                              {formatDisplayDate(row.oldestUnpaidDueDate)} ({row.oldestUnpaidPeriod})
                            </TD>
                            <TD>{formatDisplayDate(row.lastPaymentDate)}</TD>
                            <TD>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => navigateToUnitAccount(row.unitId)}
                                  className="text-xs text-blue-600 hover:underline"
                                >
                                  Ver cuenta
                                </button>
                                <button
                                  type="button"
                                  onClick={() => router.push(`/${tenantId}/communications`)}
                                  className="text-xs text-blue-600 hover:underline"
                                >
                                  Enviar recordatorio
                                </button>
                                <button
                                  type="button"
                                  onClick={() => router.push(`/${tenantId}/finanzas/pagos`)}
                                  className="text-xs text-blue-600 hover:underline"
                                >
                                  Registrar pago
                                </button>
                              </div>
                            </TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

const DashboardPage = () => {
  const router = useRouter();
  const { tenantId, isReady } = useContextAware();
  const session = useAuthSession();
  const effectiveRole = useEffectiveRole(tenantId);
  const isSuperAdmin = useIsSuperAdmin();

  useEffect(() => {
    if (isSuperAdmin && isReady) {
      router.replace('/super-admin');
    }
  }, [isSuperAdmin, isReady, router]);

  useEffect(() => {
    if (effectiveRole === 'RESIDENT' && isReady && tenantId) {
      router.replace(`/${tenantId}/resident/dashboard`);
    }
  }, [effectiveRole, isReady, tenantId, router]);

  if (!isReady || !session || !tenantId || isSuperAdmin) {
    return (
      <div className="space-y-8">
        <Card>
          <Skeleton className="mb-4 h-8 w-48" />
          <Skeleton className="h-24" />
        </Card>
      </div>
    );
  }

  if (!effectiveRole) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <h3 className="text-lg font-semibold text-amber-900">Sin acceso</h3>
        <p className="mt-2 text-sm text-amber-700">
          No tenés un rol en este tenant. Contactá a tu administrador.
        </p>
      </Card>
    );
  }

  if (
    effectiveRole === 'TENANT_OWNER' ||
    effectiveRole === 'TENANT_ADMIN' ||
    effectiveRole === 'OPERATOR'
  ) {
    return (
      <div className="space-y-8">
        <OnboardingChecklist />
        <AdminDashboard tenantId={tenantId} />
      </div>
    );
  }

  return null;
};

export default DashboardPage;
