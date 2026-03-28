'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useMemo } from 'react';
import Card from "@/shared/components/ui/Card";
import Skeleton from "@/shared/components/ui/Skeleton";
import OnboardingChecklist from "@/features/onboarding/OnboardingChecklist";
import { useContextAware } from "@/features/buildings/hooks/useContextAware";
import { useAuthSession, useIsSuperAdmin } from "@/features/auth/useAuthSession";
import { useEffectiveRole } from "@/features/tenancy/hooks/useEffectiveRole";
import { useDashboardSummary, useBuildingList } from "@/features/dashboard/hooks/useDashboardSummary";
import { DashboardPeriod } from "@/features/dashboard/services/dashboard.api";
import { Table, THead, TBody, TR, TH, TD } from "@/shared/components/ui/Table";
import { AlertCircle, CheckCircle, DollarSign, Percent, Home, Users, Wrench, CreditCard, Building } from 'lucide-react';

interface Params {
  tenantId: string;
  [key: string]: string | string[];
}

const formatARS = (cents: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(cents / 100);

const formatPercentage = (value: number) => `${Math.round(value * 100)}%`;

const PERIOD_LABELS: Record<string, string> = {
  CURRENT_MONTH: 'Mes actual',
  PREVIOUS_MONTH: 'Mes anterior',
  LAST_30_DAYS: 'Últimos 30 días',
};

const QUICK_ACTION_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  CREATE_CHARGE: { label: 'Crear expensa', icon: <DollarSign className="w-4 h-4" /> },
  RECORD_PAYMENT: { label: 'Registrar pago', icon: <CreditCard className="w-4 h-4" /> },
  INVITE_RESIDENT: { label: 'Invitar residente', icon: <Users className="w-4 h-4" /> },
  CREATE_TICKET: { label: 'Crear ticket', icon: <Wrench className="w-4 h-4" /> },
  SEND_ANNOUNCEMENT: { label: 'Enviar comunicado', icon: <AlertCircle className="w-4 h-4" /> },
};

const RISK_COLORS = {
  HIGH: 'bg-red-100 text-red-800',
  MEDIUM: 'bg-yellow-100 text-yellow-800',
  LOW: 'bg-green-100 text-green-800',
};

interface KPICardProps {
  label: string;
  value: string;
  subValue?: string;
  color: string;
  icon: React.ReactNode;
  cta?: string;
  onClick?: () => void;
}

const KPICard = ({
  label,
  value,
  subValue,
  color,
  icon,
  cta,
  onClick,
}: KPICardProps) => {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-600">{label}</p>
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
          {subValue && <p className="text-xs text-gray-500">{subValue}</p>}
        </div>
        <div className={`p-2 rounded-lg ${color.replace('text-', 'bg-').replace('600', '100')}`}>
          {icon}
        </div>
      </div>
      {cta && onClick && (
        <button
          onClick={onClick}
          className="mt-2 text-sm text-blue-600 hover:underline"
        >
          {cta}
        </button>
      )}
    </Card>
  );
}

interface EmptyStateProps {
  message: string;
  icon: React.ReactNode;
}

const EmptyState = ({ message, icon }: EmptyStateProps) => {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="text-green-600 mb-2">{icon}</div>
      <p className="text-gray-600">{message}</p>
    </div>
  );
}

interface AdminDashboardProps { tenantId: string }

const AdminDashboard = ({ tenantId }: AdminDashboardProps) => {
  const router = useRouter();
  const [period, setPeriod] = useState<DashboardPeriod>(DashboardPeriod.CURRENT_MONTH);
  const [buildingFilter, setBuildingFilter] = useState<string | undefined>(undefined);

  const { data: summary, isPending: loading, error, refetch } = useDashboardSummary({
    period,
    buildingId: buildingFilter,
  });

  const { data: buildings } = useBuildingList(tenantId);

  // Convert error to string message
  const errorMessage = error ? (error instanceof Error ? error.message : String(error)) : null;

  const buildingOptions = useMemo(() => {
    if (!buildings) return [];
    return [{ id: '', name: 'Todos los edificios' }, ...buildings];
  }, [buildings]);

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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const kpis = summary?.kpis;
  const queues = summary?.queues;
  const buildingAlerts = summary?.buildingAlerts || [];
  const quickActions = summary?.quickActions || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Dashboard Admin</h1>
        <p className="text-gray-600">Resumen operativo de tus edificios</p>
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600">Período:</label>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as DashboardPeriod)}
            className="border rounded-md px-3 py-2 text-sm"
          >
            {Object.entries(PERIOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600">Edificio:</label>
          <select
            value={buildingFilter || ''}
            onChange={(e) => setBuildingFilter(e.target.value || undefined)}
            className="border rounded-md px-3 py-2 text-sm"
          >
            {buildingOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPICard
          label="Saldo Pendiente"
          value={kpis?.outstandingAmount != null ? formatARS(kpis.outstandingAmount) : '-'}
          color="text-orange-600"
          icon={<DollarSign className="w-5 h-5 text-orange-600" />}
          cta="Ver morosidad"
          onClick={() => router.push(`/${tenantId}/finanzas`)}
        />
        <KPICard
          label="Cobrado en el mes"
          value={kpis?.collectedAmount != null ? formatARS(kpis.collectedAmount) : '-'}
          subValue={kpis?.collectedAmount != null ? `de ${formatARS((kpis.outstandingAmount || 0) + kpis.collectedAmount)}` : undefined}
          color="text-green-600"
          icon={<DollarSign className="w-5 h-5 text-green-600" />}
          cta="Ver cobros"
          onClick={() => router.push(`/${tenantId}/finanzas`)}
        />
        <KPICard
          label="Tasa de cobranza"
          value={kpis?.collectionRate != null ? formatPercentage(kpis.collectionRate) : '-'}
          color="text-blue-600"
          icon={<Percent className="w-5 h-5 text-blue-600" />}
          cta="Enviar recordatorios"
          onClick={() => handleQuickAction('SEND_ANNOUNCEMENT')}
        />
        <KPICard
          label="Unidades morosas"
          value={kpis?.delinquentUnits != null ? kpis.delinquentUnits.toString() : '-'}
          color="text-red-600"
          icon={<Home className="w-5 h-5 text-red-600" />}
          cta="Ver unidades"
          onClick={() => router.push(`/${tenantId}/units`)}
        />
      </div>

      {/* Pendientes / Work Queue */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Tickets */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Tickets</h3>
            <button
              onClick={() => router.push(`/${tenantId}/tickets`)}
              className="text-sm text-blue-600 hover:underline"
            >
              Ver todos
            </button>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Abiertos:</span>
              <span className="font-medium">{queues?.tickets.open || 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>En progreso:</span>
              <span className="font-medium">{queues?.tickets.inProgress || 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Vencidos:</span>
              <span className="font-medium text-red-600">{queues?.tickets.overdue || 0}</span>
            </div>
          </div>
          {queues?.tickets.top && queues.tickets.top.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-gray-500 mb-2">Top 5:</p>
              <div className="space-y-1">
                {queues.tickets.top.slice(0, 5).map((t) => (
                  <div key={t.id} className="text-sm truncate">
                    <span className="font-medium">{t.title}</span>
                    <span className="text-gray-500 text-xs ml-2">- {t.buildingName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {queues?.tickets.open === 0 && queues?.tickets.inProgress === 0 && (
            <EmptyState
              message="No hay tickets abiertos"
              icon={<CheckCircle className="w-8 h-8" />}
            />
          )}
        </Card>

        {/* Pagos a validar */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Pagos a validar</h3>
            <button
              onClick={() => router.push(`/${tenantId}/finanzas`)}
              className="text-sm text-blue-600 hover:underline"
            >
              Validar
            </button>
          </div>
          <div className="flex justify-between text-sm">
            <span>Pendientes:</span>
            <span className="font-medium">{queues?.paymentsToValidate.count || 0}</span>
          </div>
          {queues?.paymentsToValidate.top && queues.paymentsToValidate.top.length > 0 && (
            <div className="mt-4 space-y-2">
              {queues.paymentsToValidate.top.slice(0, 3).map((p) => (
                <div key={p.id} className="text-sm">
                  <span className="font-medium">{p.unitLabel}</span>
                  <span className="text-gray-500 text-xs ml-2">{formatARS(p.amount)}</span>
                </div>
              ))}
            </div>
          )}
          {queues?.paymentsToValidate.count === 0 && (
            <EmptyState
              message="No hay pagos pendientes"
              icon={<CheckCircle className="w-8 h-8" />}
            />
          )}
        </Card>

        {/* Unidades sin responsable */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Sin responsable</h3>
            <button
              onClick={() => router.push(`/${tenantId}/units`)}
              className="text-sm text-blue-600 hover:underline"
            >
              Asignar
            </button>
          </div>
          <div className="flex justify-between text-sm">
            <span>Sin asignar:</span>
            <span className="font-medium">{queues?.unitsWithoutResponsible.count || 0}</span>
          </div>
          {queues?.unitsWithoutResponsible.top && queues.unitsWithoutResponsible.top.length > 0 && (
            <div className="mt-4 space-y-2">
              {queues.unitsWithoutResponsible.top.slice(0, 3).map((u) => (
                <div key={u.unitId} className="text-sm">
                  <span className="font-medium">{u.unitLabel}</span>
                  <span className="text-gray-500 text-xs ml-2">- {u.buildingName}</span>
                </div>
              ))}
            </div>
          )}
          {queues?.unitsWithoutResponsible.count === 0 && (
            <EmptyState
              message="Todas las unidades tienen responsable"
              icon={<CheckCircle className="w-8 h-8" />}
            />
          )}
        </Card>
      </div>

      {/* Building Alerts */}
      <Card className="p-4">
        <h3 className="font-semibold mb-4">Edificios con alertas</h3>
        {buildingAlerts.length > 0 ? (
          <Table>
            <THead>
              <TR>
                <TH>Edificio</TH>
                <TH className="text-right">Deuda</TH>
                <TH className="text-right">Tickets</TH>
                <TH className="text-right">Sin responsable</TH>
                <TH className="text-center">Riesgo</TH>
                <TH></TH>
              </TR>
            </THead>
            <TBody>
              {buildingAlerts.map((alert) => (
                <TR key={alert.buildingId}>
                  <TD className="font-medium">{alert.buildingName}</TD>
                  <TD className="text-right text-orange-600">
                    {alert.outstandingAmount > 0 ? formatARS(alert.outstandingAmount) : '-'}
                  </TD>
                  <TD className="text-right">{alert.overdueTickets}</TD>
                  <TD className="text-right">{alert.unitsWithoutResponsible}</TD>
                  <TD className="text-center">
                    <span className={`px-2 py-1 rounded-full text-xs ${RISK_COLORS[alert.riskScore]}`}>
                      {alert.riskScore}
                    </span>
                  </TD>
                  <TD>
                    <button
                      onClick={() => router.push(`/${tenantId}/buildings/${alert.buildingId}`)}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      Ver detalle
                    </button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            message="No hay alertas"
            icon={<CheckCircle className="w-8 h-8" />}
          />
        )}
      </Card>

      {/* Quick Actions */}
      <Card className="p-4">
        <h3 className="font-semibold mb-4">Acciones rápidas</h3>
        <div className="flex flex-wrap gap-2">
          {quickActions.map((action) => {
            const actionInfo = QUICK_ACTION_LABELS[action];
            if (!actionInfo) return null;
            return (
              <button
                key={action}
                onClick={() => handleQuickAction(action)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition"
              >
                {actionInfo.icon}
                <span className="text-sm font-medium">{actionInfo.label}</span>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

const DashboardPage = () => {
  const router = useRouter();
  const { tenantId, isReady } = useContextAware();
  const session = useAuthSession();
  const effectiveRole = useEffectiveRole(tenantId);
  const isSuperAdmin = useIsSuperAdmin();

  // SUPER_ADMIN users should NOT access tenant-level dashboard
  useEffect(() => {
    if (isSuperAdmin && isReady) {
      router.replace('/super-admin');
    }
  }, [isSuperAdmin, isReady, router]);

  // RESIDENT users go to the resident portal
  useEffect(() => {
    if (effectiveRole === 'RESIDENT' && isReady && tenantId) {
      router.replace(`/${tenantId}/resident/dashboard`);
    }
  }, [effectiveRole, isReady, tenantId, router]);

  if (!isReady || !session || !tenantId || isSuperAdmin) {
    return (
      <div className="space-y-8">
        <Card>
          <Skeleton className="h-8 w-48 mb-4" />
          <Skeleton className="h-24" />
        </Card>
      </div>
    );
  }

  if (!effectiveRole) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <h3 className="text-lg font-semibold text-amber-900">Sin acceso</h3>
        <p className="text-sm text-amber-700 mt-2">
          No tenés un rol en este tenant. Contactá a tu administrador.
        </p>
      </Card>
    );
  }

  // TENANT_OWNER or TENANT_ADMIN - Show new dashboard
  if (effectiveRole === 'TENANT_OWNER' || effectiveRole === 'TENANT_ADMIN') {
    return (
      <div className="space-y-8">
        <OnboardingChecklist />
        <AdminDashboard tenantId={tenantId} />
      </div>
    );
  }

  // OPERATOR - Show operator dashboard
  if (effectiveRole === 'OPERATOR') {
    return (
      <div className="space-y-8">
        <OnboardingChecklist />
        <AdminDashboard tenantId={tenantId} />
      </div>
    );
  }

  // Fallback for RESIDENT (shouldn't reach here due to redirect above)
  return null;
};

export default DashboardPage;
