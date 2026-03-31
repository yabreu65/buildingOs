'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  CreditCard,
  Bell,
  MessageSquare,
  CheckCircle,
  AlertCircle,
  DollarSign,
} from 'lucide-react';

import { useAuthSession } from '../../../../../features/auth/useAuthSession';
import { useResidentContext } from '../../../../../features/resident/hooks/useResidentContext';
import { useResidentLedger } from '../../../../../features/resident/hooks/useResidentLedger';
import { getResidentCommunications, getResidentTickets } from '../../../../../features/resident/api/resident-context.api';
import { getContextOptions } from '../../../../../features/context/context.api';
import { useTenants } from '../../../../../features/tenants/tenants.hooks';
import type { InboxCommunication, Ticket } from '../../../../../features/resident/api/resident-context.api';
import type { ContextOption } from '../../../../../features/context/context.types';
import Card from '../../../../../shared/components/ui/Card';
import Skeleton from '../../../../../shared/components/ui/Skeleton';
import { formatCurrency } from '../../../../../shared/lib/format/money';

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '—';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(dateStr));
}

function ticketStatusLabel(status: Ticket['status']): string {
  const labels: Record<Ticket['status'], string> = {
    OPEN: 'Abierto',
    IN_PROGRESS: 'En proceso',
    RESOLVED: 'Resuelto',
    CLOSED: 'Cerrado',
  };
  return labels[status] ?? status;
}

interface KPICardProps {
  label: string;
  value: string;
  subValue?: string;
  color: string;
  icon: React.ReactNode;
  cta?: string;
  onClick?: () => void;
}

const KPICard = ({ label, value, subValue, color, icon, cta, onClick }: KPICardProps) => {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
          {subValue && <p className="text-xs text-muted-foreground">{subValue}</p>}
        </div>
        <div className={`p-2 rounded-lg ${color.replace('text-', 'bg-').replace('600', '100').replace('700', '100')}`}>
          {icon}
        </div>
      </div>
      {cta && onClick && (
        <button onClick={onClick} className="mt-2 text-sm text-blue-600 hover:underline">
          {cta}
        </button>
      )}
    </Card>
  );
};

const ResidentDashboardPage = () => {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId;
  const session = useAuthSession();
  const userName = session?.user?.name ?? '';

  const { data: tenants } = useTenants();
  const tenantName = tenants?.find((t) => t.id === tenantId)?.name ?? tenantId;

  const { data: context, isLoading: contextLoading } = useResidentContext(tenantId ?? null);
  const buildingId = context?.activeBuildingId ?? null;
  const unitId = context?.activeUnitId ?? null;
  const hasContext = !!buildingId && !!unitId;

  const { data: contextOptions } = useQuery<{ buildings: ContextOption[]; unitsByBuilding: Record<string, ContextOption[]> }>({
    queryKey: ['contextOptions', tenantId],
    queryFn: () => getContextOptions(tenantId!),
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
  });

  const buildingName = contextOptions?.buildings.find((b) => b.id === buildingId)?.name ?? null;
  const unitLabel = buildingId && unitId ? contextOptions?.unitsByBuilding[buildingId]?.find((u) => u.id === unitId)?.label ?? null : null;

  const { data: ledger, isLoading: ledgerLoading } = useResidentLedger(unitId);

  const { data: communications = [], isLoading: commsLoading } = useQuery<InboxCommunication[]>({
    queryKey: ['residentCommunications'],
    queryFn: () => getResidentCommunications(3),
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });

  const { data: tickets = [], isLoading: ticketsLoading } = useQuery<Ticket[]>({
    queryKey: ['residentTickets', buildingId, unitId],
    queryFn: () => getResidentTickets(buildingId!, unitId!, 3),
    enabled: !!buildingId && !!unitId,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });

  const balance = ledger?.totals?.balance ?? 0;
  const currency = ledger?.totals?.currency ?? 'ARS';

  const lastPayment = ledger?.payments
    ?.slice()
    .sort((a, b) => new Date(b.paidAt ?? b.createdAt).getTime() - new Date(a.paidAt ?? a.createdAt).getTime())[0];

  const nextDueCharge = ledger?.charges
    ?.filter((c) => (c.amount - (c.allocated ?? 0)) > 0)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];

  const isLoading = contextLoading || ledgerLoading;

  if (isLoading || commsLoading || ticketsLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">
          {userName ? `Hola, ${userName}` : 'Mi portal'}
        </h1>
        <p className="text-muted-foreground">
          {tenantName}
          {buildingName && ` • ${buildingName}`}
          {unitLabel && ` • Unidad ${unitLabel}`}
        </p>
      </div>

      {/* Context alert if no unit */}
      {!hasContext && (
        <Card className="p-4 border-yellow-300 bg-yellow-50">
          <div className="flex items-center gap-2">
            <AlertCircle className="text-yellow-600" size={20} />
            <div>
              <p className="font-medium text-yellow-800">Sin unidad asignada</p>
              <p className="text-sm text-yellow-700">Comunicate con la administración para que te asignen una unidad.</p>
            </div>
          </div>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPICard
          label="Saldo pendiente"
          value={balance > 0 ? formatCurrency(balance, currency) : formatCurrency(0, currency)}
          color={balance > 0 ? "text-orange-600" : "text-green-600"}
          icon={<DollarSign className={`w-5 h-5 ${balance > 0 ? "text-orange-600" : "text-green-600"}`} />}
          cta={balance > 0 ? "Ver detalles" : undefined}
          onClick={balance > 0 ? () => window.location.href = `/${tenantId}/resident/payments` : undefined}
        />
        <KPICard
          label="Último pago"
          value={lastPayment ? formatCurrency(lastPayment.amount, lastPayment.currency ?? currency) : '—'}
          subValue={lastPayment ? formatDate(lastPayment.paidAt) : 'Sin pagos'}
          color="text-green-600"
          icon={<DollarSign className="w-5 h-5 text-green-600" />}
        />
        <KPICard
          label="Próximo vencimiento"
          value={nextDueCharge ? formatDate(nextDueCharge.dueDate) : '—'}
          subValue={nextDueCharge ? formatCurrency(nextDueCharge.amount, currency) : 'Sin cargos'}
          color="text-blue-600"
          icon={<AlertCircle className="w-5 h-5 text-blue-600" />}
        />
        <KPICard
          label="Comunicados"
          value={communications.length.toString()}
          subValue="recientes"
          color="text-purple-600"
          icon={<Bell className="w-5 h-5 text-purple-600" />}
        />
      </div>

      {/* Quick Actions */}
      <Card className="p-4">
        <h3 className="font-semibold mb-4">Acciones rápidas</h3>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/${tenantId}/resident/payments`}
            className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition"
          >
            <CreditCard className="w-4 h-4" />
            <span className="text-sm font-medium">Pagar expensa</span>
          </Link>
          <Link
            href={`/${tenantId}/resident/announcements`}
            className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition"
          >
            <Bell className="w-4 h-4" />
            <span className="text-sm font-medium">Ver comunicados</span>
          </Link>
          <Link
            href={`/${tenantId}/resident/tickets`}
            className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition"
          >
            <MessageSquare className="w-4 h-4" />
            <span className="text-sm font-medium">Crear ticket</span>
          </Link>
        </div>
      </Card>

      {/* Lists */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Communications */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Comunicados recientes</h3>
            <Link href={`/${tenantId}/resident/announcements`} className="text-sm text-blue-600 hover:underline">
              Ver todos
            </Link>
          </div>
          {communications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6">
              <CheckCircle className="w-8 h-8 text-green-600 mb-2" />
              <p className="text-muted-foreground">Sin comunicados</p>
            </div>
          ) : (
            <div className="space-y-2">
              {communications.slice(0, 3).map((comm) => (
                <div key={comm.id} className="flex justify-between text-sm">
                  <span className="truncate flex-1">{comm.title}</span>
                  <span className="text-muted-foreground text-xs ml-2">{formatDate(comm.sentAt ?? comm.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Tickets */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Mis tickets</h3>
            <Link href={`/${tenantId}/resident/tickets`} className="text-sm text-blue-600 hover:underline">
              Ver todos
            </Link>
          </div>
          {tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6">
              <CheckCircle className="w-8 h-8 text-green-600 mb-2" />
              <p className="text-muted-foreground">Sin tickets abiertos</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tickets.slice(0, 3).map((ticket) => (
                <div key={ticket.id} className="flex justify-between text-sm">
                  <span className="truncate flex-1">{ticket.title}</span>
                  <span className="text-muted-foreground text-xs ml-2">{ticketStatusLabel(ticket.status)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default ResidentDashboardPage;
