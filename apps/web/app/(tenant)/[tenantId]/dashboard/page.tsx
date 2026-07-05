'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, useMemo } from 'react';
import Card from "@/shared/components/ui/Card";
import Skeleton from "@/shared/components/ui/Skeleton";
import { OnboardingChecklist } from "@/features/onboarding/OnboardingChecklist";
import { useContextAware } from "@/features/buildings/hooks/useContextAware";
import { useAuthSession, useIsSuperAdmin } from "@/features/auth/useAuthSession";
import { useEffectiveRole } from "@/features/tenancy/hooks/useEffectiveRole";
import { useDashboardSummary, useBuildingList } from "@/features/dashboard/hooks/useDashboardSummary";
import { Table, THead, TBody, TR, TH, TD } from "@/shared/components/ui/Table";
import { formatAccountingPeriodLabel, getCurrentAccountingPeriod } from "@/features/dashboard/utils/period";
import { getTotalAccumulatedDebt } from "@/features/dashboard/utils/building-alerts";
import {
  AlertCircle,
  CheckCircle,
  DollarSign,
  Percent,
  Home,
  Users,
  Wrench,
  CreditCard,
  Building,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  Ticket,
  FileWarning,
  UserX,
  Sparkles,
} from 'lucide-react';

interface Params {
  readonly tenantId: string;
  readonly [key: string]: string | string[];
}

const formatARS = (cents: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(cents / 100);

const formatPercentage = (value: number) => `${Math.round(value * 100)}%`;

interface QuickActionInfo {
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly desc: string;
}

const QUICK_ACTION_LABELS: Record<string, QuickActionInfo> = {
  CREATE_CHARGE: { label: 'Registrar gasto', icon: <DollarSign className="w-5 h-5" />, desc: 'Se convierte en cargo al publicar la liquidación' },
  RECORD_PAYMENT: { label: 'Registrar pago', icon: <CreditCard className="w-5 h-5" />, desc: 'Pago de residente' },
  INVITE_RESIDENT: { label: 'Invitar residente', icon: <Users className="w-5 h-5" />, desc: 'Sumar nuevo vecino' },
  CREATE_TICKET: { label: 'Crear ticket', icon: <Wrench className="w-5 h-5" />, desc: 'Reportar problema' },
  SEND_ANNOUNCEMENT: { label: 'Enviar comunicado', icon: <AlertCircle className="w-5 h-5" />, desc: 'Aviso a residentes' },
};

// ── Risk & Status Tokens ────────────────────────────────────────────────────

const RISK_BADGES = {
  HIGH: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  MEDIUM: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  LOW: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
};

const RISK_LABELS: Record<string, string> = {
  HIGH: 'Alto',
  MEDIUM: 'Medio',
  LOW: 'Bajo',
};

function collectionRateColor(rate: number): string {
  if (rate >= 0.8) return 'bg-green-500';
  if (rate >= 0.5) return 'bg-yellow-500';
  return 'bg-red-500';
}

function collectionRateIcon(rate: number) {
  if (rate >= 0.8) return <TrendingUp className="w-4 h-4 text-green-500" />;
  if (rate >= 0.5) return <TrendingUp className="w-4 h-4 text-yellow-500" />;
  return <TrendingDown className="w-4 h-4 text-red-500" />;
}

function collectionRateLabel(rate: number): string {
  if (rate >= 0.9) return 'Excelente';
  if (rate >= 0.8) return 'Buena';
  if (rate >= 0.5) return 'Regular';
  return 'Baja';
}

interface SeverityStyle {
  readonly bg: string;
  readonly text: string;
}

function delinquentSeverity(count: number): SeverityStyle {
  if (count >= 8) return { bg: 'bg-red-500/10', text: 'text-red-400' };
  if (count >= 4) return { bg: 'bg-yellow-500/10', text: 'text-yellow-400' };
  return { bg: 'bg-green-500/10', text: 'text-green-400' };
}

// ── KPI Card ────────────────────────────────────────────────────────────────

interface KPICardProps {
  readonly label: string;
  readonly value: string;
  readonly subtitle?: string;
  readonly subValue?: string;
  readonly badge?: BadgeInfo;
  readonly color: string;
  readonly icon: React.ReactNode;
  readonly cta?: string;
  readonly onClick?: () => void;
  readonly children?: React.ReactNode;
}

interface BadgeInfo {
  readonly label: string;
  readonly color: string;
}

const KPICard = ({ label, value, subtitle, subValue, badge, color, icon, cta, onClick, children }: KPICardProps) => (
  <Card className="p-5 hover:shadow-md transition-shadow duration-200">
    <div className="flex items-start justify-between mb-3">
      <div className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground tracking-tight">{label}</p>
        {subtitle && <p className="text-xs text-muted-foreground/80 max-w-[18rem]">{subtitle}</p>}
      </div>
      <div className={`p-2.5 rounded-xl ${color.replace('text-', 'bg-').replace('400', '500/10').replace('500', '500/10')}`}>
        {icon}
      </div>
    </div>
    <div className="space-y-1">
      <p className={`text-3xl font-bold tracking-tight ${color}`}>{value}</p>
      {subValue && <p className="text-xs text-muted-foreground">{subValue}</p>}
      {badge && (
        <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.color}`}>
          {badge.label}
        </span>
      )}
    </div>
    {children}
    {cta && onClick && (
      <button onClick={onClick} className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-500 transition flex items-center gap-1">
        {cta}
        <ArrowUpRight className="w-3.5 h-3.5" />
      </button>
    )}
  </Card>
);

interface SectionHeaderProps {
  readonly title: string;
  readonly subtitle: string;
  readonly action?: React.ReactNode;
}

const SectionHeader = ({ title, subtitle, action }: SectionHeaderProps) => (
  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
    <div>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);

// ── Empty State ─────────────────────────────────────────────────────────────

interface EmptyStateProps {
  readonly message: string;
  readonly sub?: string;
  readonly icon: React.ReactNode;
  readonly cta?: string;
  readonly onCta?: () => void;
}

const EmptyState = ({ message, sub, icon, cta, onCta }: EmptyStateProps) => (
  <div className="flex flex-col items-center justify-center py-10 text-center">
    <div className="mb-3 text-muted-foreground/60">{icon}</div>
    <p className="text-sm font-medium text-muted-foreground">{message}</p>
    {sub && <p className="text-xs text-muted-foreground/60 mt-1">{sub}</p>}
    {cta && onCta && (
      <button onClick={onCta} className="mt-3 text-sm text-blue-600 hover:text-blue-500 transition">
        {cta}
      </button>
    )}
  </div>
);

// ── Admin Dashboard ─────────────────────────────────────────────────────────

interface AdminDashboardProps { readonly tenantId: string }

const AdminDashboard = ({ tenantId }: AdminDashboardProps) => {
  const router = useRouter();
  const [period, setPeriod] = useState<string>(getCurrentAccountingPeriod());
  const [buildingFilter, setBuildingFilter] = useState<string | undefined>(undefined);

  const { data: summary, isPending: loading, error, refetch } = useDashboardSummary(tenantId, {
    period,
    buildingId: buildingFilter,
  });

  const { data: buildings } = useBuildingList(tenantId);
  const errorMessage = error ? (error instanceof Error ? error.message : String(error)) : null;

  const buildingOptions = useMemo(() => {
    if (!buildings) return [];
    return [{ id: '', name: 'Todos los edificios' }, ...buildings];
  }, [buildings]);

  const selectedScopeLabel = useMemo(() => {
    if (!buildingFilter) return 'Todos los edificios';
    return buildingOptions.find((building) => building.id === buildingFilter)?.name || 'Todos los edificios';
  }, [buildingFilter, buildingOptions]);

  const handleQuickAction = (action: string) => {
    const routes: Record<string, string> = {
      CREATE_CHARGE: `/${tenantId}/finanzas/cargos`,
      RECORD_PAYMENT: `/${tenantId}/finanzas/pagos`,
      INVITE_RESIDENT: `/${tenantId}/units`,
      CREATE_TICKET: `/${tenantId}/tickets`,
      SEND_ANNOUNCEMENT: `/${tenantId}/communications`,
    };
    const route = routes[action];
    if (route) router.push(route);
  };

  // ── Loading ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
        <Skeleton className="h-56" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────
  if (errorMessage) {
    return (
      <Card className="p-6 border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20">
        <div className="flex items-start gap-4">
          <FileWarning className="w-8 h-8 text-red-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-lg font-semibold text-red-800 dark:text-red-400">Error al cargar datos</h3>
            <p className="text-sm text-red-600 dark:text-red-300 mt-1">{errorMessage}</p>
            <button onClick={() => refetch()} className="mt-3 px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg text-sm font-medium hover:bg-red-200 transition">
              Reintentar
            </button>
          </div>
        </div>
      </Card>
    );
  }

  const kpis = summary?.kpis;
  const queues = summary?.queues;
  const buildingAlerts = summary?.buildingAlerts || [];
  const totalAccumulatedDebt = getTotalAccumulatedDebt(buildingAlerts);
  const quickActions = summary?.quickActions || [];

  const cr = kpis?.collectionRate ?? 0;
  const crColor = collectionRateColor(cr);
  const sev = delinquentSeverity(kpis?.delinquentUnits ?? 0);

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Panel de Administración</h1>
        <p className="text-muted-foreground mt-1">Resumen operativo del tenant y atajos para administrar los edificios.</p>
      </div>

      {/* ── Filters ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border bg-muted/20 p-4 space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Contexto del panel</p>
            <h3 className="text-lg font-semibold tracking-tight">Resumen del período seleccionado</h3>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Las métricas superiores muestran el período contable actual. La sección inferior de edificios muestra deuda acumulada, independiente del mes seleccionado.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-full bg-card px-3 py-1.5 text-sm font-medium text-foreground border">
              Período: {formatAccountingPeriodLabel(period)}
            </span>
            <span className="inline-flex items-center rounded-full bg-card px-3 py-1.5 text-sm font-medium text-foreground border">
              Alcance: {selectedScopeLabel}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2 bg-card rounded-lg px-3 py-2 border">
            <label
              htmlFor="dashboard-period"
              className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >
              Período contable
            </label>
            <input
              id="dashboard-period"
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              aria-describedby="dashboard-period-value"
              className="bg-transparent text-sm font-medium focus:outline-none cursor-pointer"
            />
            <span id="dashboard-period-value" className="text-sm text-muted-foreground whitespace-nowrap">
              {formatAccountingPeriodLabel(period)}
            </span>
          </div>
          <div className="flex items-center gap-2 bg-card rounded-lg px-3 py-2 border">
            <label
              htmlFor="dashboard-scope"
              className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >
              Ámbito
            </label>
            <select
              id="dashboard-scope"
              value={buildingFilter || ''}
              onChange={(e) => setBuildingFilter(e.target.value || undefined)}
              className="bg-transparent text-sm font-medium focus:outline-none cursor-pointer"
            >
              {buildingOptions.map((b) => (
                <option key={b.id} value={b.id} className="bg-card text-foreground">{b.name}</option>
              ))}
            </select>
          </div>
          <span className="text-xs text-muted-foreground/60 ml-auto">
            {summary?.metadata?.generatedAt ? `Actualizado ${new Date(summary.metadata.generatedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </span>
        </div>
      </div>

      {/* ── KPIs ───────────────────────────────────────────────────── */}
      <SectionHeader
        title="Resumen del período"
        subtitle="Las métricas superiores reflejan el período contable y el alcance seleccionados."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          label="Saldo pendiente del período"
          subtitle="Lo que queda por cobrar del período seleccionado."
          value={kpis?.outstandingAmount != null ? formatARS(kpis.outstandingAmount) : '$0'}
          badge={kpis?.outstandingAmount != null && kpis.outstandingAmount > 0
            ? { label: `${(kpis.delinquentUnits ?? 0)} unidades`, color: sev.text }
            : undefined}
          color={kpis?.outstandingAmount != null && kpis.outstandingAmount > 0 ? 'text-orange-400' : 'text-green-400'}
          icon={<DollarSign className="w-5 h-5 text-current" />}
          cta="Ver morosidad"
          onClick={() => router.push(`/${tenantId}/finanzas`)}
        />
        <KPICard
          label="Cobrado del período"
          subtitle="Monto cobrado o aplicado durante el período seleccionado."
          value={kpis?.collectedAmount != null ? formatARS(kpis.collectedAmount) : '$0'}
          subValue={
            kpis?.collectedAmount != null && (kpis.outstandingAmount ?? 0) + kpis.collectedAmount > 0
              ? `de ${formatARS((kpis.outstandingAmount || 0) + kpis.collectedAmount)}`
              : undefined
          }
          color="text-green-400"
          icon={<TrendingUp className="w-5 h-5 text-current" />}
          cta="Ver cobros"
          onClick={() => router.push(`/${tenantId}/finanzas`)}
        />
        <KPICard
          label="Tasa de cobranza del período"
          subtitle="Porcentaje cobrado sobre el total esperado del período."
          value={kpis?.collectionRate != null ? formatPercentage(kpis.collectionRate) : '0%'}
          badge={{ label: collectionRateLabel(cr), color: collectionRateIcon(cr).props.className || '' }}
          color={cr >= 0.8 ? 'text-green-400' : cr >= 0.5 ? 'text-yellow-400' : 'text-red-400'}
          icon={collectionRateIcon(cr)}
          cta="Ver finanzas"
          onClick={() => router.push(`/${tenantId}/finanzas`)}
        >
          {/* Collection rate bar */}
          <div className="mt-3 w-full bg-muted rounded-full h-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${crColor}`}
              style={{ width: `${Math.min(cr * 100, 100)}%` }}
            />
          </div>
        </KPICard>
        <KPICard
          label="Unidades morosas del período"
          subtitle="Unidades con saldo abierto dentro del período seleccionado."
          value={kpis?.delinquentUnits != null ? kpis.delinquentUnits.toString() : '0'}
          badge={
            kpis?.delinquentUnits != null && kpis.delinquentUnits > 0
              ? { label: 'Requieren atención', color: 'text-red-400 bg-red-500/10' }
              : { label: 'Todas al día', color: 'text-green-400 bg-green-500/10' }
          }
          color={kpis?.delinquentUnits != null && kpis.delinquentUnits > 0 ? 'text-red-400' : 'text-green-400'}
          icon={<Home className="w-5 h-5 text-current" />}
          cta="Ver unidades"
          onClick={() => router.push(`/${tenantId}/units`)}
        />
      </div>

      {/* ── Queues ─────────────────────────────────────────────────── */}
      <SectionHeader
        title="Tareas operativas"
        subtitle="Atajos y colas que requieren revisión o acción inmediata."
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Tickets */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Ticket className="w-5 h-5 text-muted-foreground" />
              <div>
                <h3 className="font-semibold">Solicitudes</h3>
                <p className="text-xs text-muted-foreground">Tickets abiertos y en progreso.</p>
              </div>
            </div>
            <button onClick={() => router.push(`/${tenantId}/tickets`)} className="text-sm font-medium text-blue-600 hover:text-blue-500 transition">
              Ver solicitudes
            </button>
          </div>
          {(queues?.tickets.open ?? 0) > 0 || (queues?.tickets.inProgress ?? 0) > 0 ? (
            <>
              <div className="flex gap-4 mb-3">
                <div className="flex-1 bg-red-500/10 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-red-400">{queues?.tickets.open ?? 0}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Abiertos</p>
                </div>
                <div className="flex-1 bg-yellow-500/10 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-yellow-400">{queues?.tickets.inProgress ?? 0}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">En progreso</p>
                </div>
              </div>
              {queues?.tickets.top && queues.tickets.top.length > 0 && (
                <div className="space-y-2 border-t border-border pt-3">
                  {queues.tickets.top.slice(0, 5).map((t) => (
                    <div key={t.id} className="flex items-center gap-2 text-sm">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.status === 'OPEN' ? 'bg-red-400' : 'bg-yellow-400'}`} />
                      <span className="truncate flex-1">{t.title}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{t.buildingName}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <EmptyState message="No hay tickets abiertos" sub="Todo en orden por ahora" icon={<CheckCircle className="w-8 h-8" />} cta="Crear ticket" onCta={() => handleQuickAction('CREATE_TICKET')} />
          )}
        </Card>

        {/* Pagos a validar */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-muted-foreground" />
              <div>
                <h3 className="font-semibold">Pagos por revisar</h3>
                <p className="text-xs text-muted-foreground">Pagos enviados que esperan validación.</p>
              </div>
            </div>
            <button onClick={() => router.push(`/${tenantId}/finanzas`)} className="text-sm font-medium text-blue-600 hover:text-blue-500 transition">
              Validar
            </button>
          </div>
          {(queues?.paymentsToValidate.count ?? 0) > 0 ? (
            <>
              <div className="bg-orange-500/10 rounded-lg p-3 text-center mb-3">
                <p className="text-2xl font-bold text-orange-400">{queues?.paymentsToValidate.count}</p>
                <p className="text-xs text-muted-foreground mt-0.5">pendientes de revisión</p>
              </div>
              {queues?.paymentsToValidate.top && queues.paymentsToValidate.top.length > 0 && (
                <div className="space-y-2 border-t border-border pt-3">
                  {queues.paymentsToValidate.top.slice(0, 3).map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-sm">
                      <span className="font-medium truncate">{p.unitLabel}</span>
                      <span className="text-xs text-muted-foreground ml-2">{p.buildingName}</span>
                      <span className="font-mono text-sm ml-auto">{formatARS(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <EmptyState message="Sin pagos pendientes" sub="Todos los pagos fueron revisados" icon={<CheckCircle className="w-8 h-8" />} />
          )}
        </Card>

        {/* Unidades sin responsable */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <UserX className="w-5 h-5 text-muted-foreground" />
              <div>
                <h3 className="font-semibold">Unidades sin responsable</h3>
                <p className="text-xs text-muted-foreground">Unidades que aún no tienen residente asignado.</p>
              </div>
            </div>
            <button onClick={() => router.push(`/${tenantId}/units`)} className="text-sm font-medium text-blue-600 hover:text-blue-500 transition">
              Asignar
            </button>
          </div>
          {(queues?.unitsWithoutResponsible.count ?? 0) > 0 ? (
            <>
              <div className="bg-purple-500/10 rounded-lg p-3 text-center mb-3">
                <p className="text-2xl font-bold text-purple-400">{queues?.unitsWithoutResponsible.count}</p>
                <p className="text-xs text-muted-foreground mt-0.5">unidades sin asignar</p>
              </div>
              {queues?.unitsWithoutResponsible.top && queues.unitsWithoutResponsible.top.length > 0 && (
                <div className="space-y-2 border-t border-border pt-3">
                  {queues.unitsWithoutResponsible.top.slice(0, 3).map((u) => (
                    <div key={u.unitId} className="flex items-center gap-2 text-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                      <span className="font-medium truncate">{u.unitLabel}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{u.buildingName}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <EmptyState message="Todas las unidades asignadas" sub="Cada unidad tiene responsable" icon={<CheckCircle className="w-8 h-8" />} />
          )}
        </Card>
      </div>

      {/* ── Building Alerts ────────────────────────────────────────── */}
      <Card className="p-4">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-2">
            <Building className="w-5 h-5 text-muted-foreground mt-0.5" />
            <div>
              <h3 className="font-semibold">Deuda acumulada por edificio</h3>
              <p className="text-xs text-muted-foreground mt-1">Incluye saldos pendientes de todos los períodos.</p>
            </div>
          </div>
        </div>
        {buildingAlerts.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Edificio</TH>
                  <TH className="text-right">Deuda acumulada</TH>
                  <TH className="text-right">Tickets</TH>
                  <TH className="text-right">Sin responsable</TH>
                  <TH className="text-center">Riesgo</TH>
                  <TH></TH>
                </TR>
              </THead>
              <TBody>
                {buildingAlerts.map((alert) => (
                  <TR key={alert.buildingId} className="hover:bg-muted/50 transition-colors">
                    <TD className="font-medium">{alert.buildingName}</TD>
                    <TD className="text-right">
                      <span className={alert.outstandingAmount > 0 ? 'text-orange-400 font-medium' : 'text-muted-foreground'}>
                        {alert.outstandingAmount > 0 ? formatARS(alert.outstandingAmount) : '$0'}
                      </span>
                    </TD>
                    <TD className="text-right">
                      <span className={alert.overdueTickets > 0 ? 'text-red-400 font-medium' : 'text-muted-foreground'}>
                        {alert.overdueTickets}
                      </span>
                    </TD>
                    <TD className="text-right">
                      <span className={alert.unitsWithoutResponsible > 0 ? 'text-purple-400 font-medium' : 'text-muted-foreground'}>
                        {alert.unitsWithoutResponsible}
                      </span>
                    </TD>
                    <TD className="text-center">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${RISK_BADGES[alert.riskScore]}`}>
                        {RISK_LABELS[alert.riskScore]}
                      </span>
                    </TD>
                    <TD>
                      <button
                        onClick={() => router.push(`/${tenantId}/buildings/${alert.buildingId}`)}
                        className="text-sm font-medium text-blue-600 hover:text-blue-500 transition"
                      >
                        Ver detalle
                      </button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        ) : (
          <EmptyState message="Sin alertas activas" sub="Todos los edificios están al día" icon={<CheckCircle className="w-8 h-8" />} />
        )}
        {buildingAlerts.length > 0 && (
          <div className="flex justify-end mt-4 pt-4 border-t border-border">
            <p className="text-sm text-muted-foreground">
              Total deuda acumulada: <span className="font-semibold text-foreground">{formatARS(totalAccumulatedDebt)}</span>
            </p>
          </div>
        )}
      </Card>

      {/* ── Quick Actions ──────────────────────────────────────────── */}
      <Card className="p-4">
        <div className="flex items-start gap-2 mb-4">
          <Sparkles className="w-5 h-5 text-muted-foreground" />
          <div>
            <h3 className="font-semibold">Acciones rápidas</h3>
            <p className="text-xs text-muted-foreground mt-1">Atajos para tareas frecuentes del administrador.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {quickActions.map((action) => {
            const actionInfo = QUICK_ACTION_LABELS[action];
            if (!actionInfo) return null;
            return (
              <button
                key={action}
                onClick={() => handleQuickAction(action)}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-muted hover:bg-muted/80 hover:shadow-sm transition-all duration-200 text-center group"
              >
                <div className="p-2.5 rounded-lg bg-card text-blue-500 group-hover:text-blue-400 transition-colors">
                  {actionInfo.icon}
                </div>
                <span className="text-sm font-medium text-foreground">{actionInfo.label}</span>
                <span className="text-[10px] text-muted-foreground">{actionInfo.desc}</span>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

const DashboardPage = () => {
  const router = useRouter();
  const { isReady } = useContextAware();
  const params = useParams<Params>();
  const routeTenantId = typeof params?.tenantId === 'string' ? params.tenantId.trim() : '';
  const session = useAuthSession();
  const effectiveRole = useEffectiveRole(routeTenantId || undefined);
  const isSuperAdmin = useIsSuperAdmin();
  const tenantReady = isReady && routeTenantId.length > 0;

  useEffect(() => {
    if (isSuperAdmin && tenantReady) router.replace('/super-admin');
  }, [isSuperAdmin, tenantReady, router]);

  useEffect(() => {
    if (effectiveRole === 'RESIDENT' && tenantReady) router.replace(`/${routeTenantId}/resident/dashboard`);
  }, [effectiveRole, tenantReady, routeTenantId, router]);

  if (!isReady) {
    return (
      <div className="space-y-8">
        <Card><Skeleton className="h-8 w-48 mb-4" /><Skeleton className="h-24" /></Card>
      </div>
    );
  }

  if (!routeTenantId) {
    return (
      <Card className="border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20">
        <h3 className="text-lg font-semibold text-amber-900 dark:text-amber-400">Tenant no válido</h3>
        <p className="text-sm text-amber-700 dark:text-amber-300 mt-2">
          No pudimos identificar el tenant en esta ruta. Revisá la URL e intentá de nuevo.
        </p>
      </Card>
    );
  }

  if (!session || isSuperAdmin) {
    return (
      <div className="space-y-8">
        <Card><Skeleton className="h-8 w-48 mb-4" /><Skeleton className="h-24" /></Card>
      </div>
    );
  }

  if (!effectiveRole) {
    return (
      <Card className="border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20">
        <h3 className="text-lg font-semibold text-amber-900 dark:text-amber-400">Sin acceso</h3>
        <p className="text-sm text-amber-700 dark:text-amber-300 mt-2">
          No tenés un rol en este tenant. Contactá a tu administrador.
        </p>
      </Card>
    );
  }

  if (effectiveRole === 'TENANT_OWNER' || effectiveRole === 'TENANT_ADMIN' || effectiveRole === 'OPERATOR') {
    return (
      <div className="space-y-8">
        <OnboardingChecklist />
        <AdminDashboard tenantId={routeTenantId} />
      </div>
    );
  }

  return null;
};

export default DashboardPage;
