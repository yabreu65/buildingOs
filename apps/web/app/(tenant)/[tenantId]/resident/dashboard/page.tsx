'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  CreditCard,
  Bell,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Clock,
} from 'lucide-react';

import { useAuthSession } from '../../../../../features/auth/useAuthSession';
import { useResidentContext } from '../../../../../features/resident/hooks/useResidentContext';
import { useResidentLedger } from '../../../../../features/resident/hooks/useResidentLedger';
import { getResidentCommunications, getResidentTickets } from '../../../../../features/resident/api/resident-context.api';
import type { InboxCommunication, Ticket } from '../../../../../features/resident/api/resident-context.api';
import Card from '../../../../../shared/components/ui/Card';
import Badge from '../../../../../shared/components/ui/Badge';
import Skeleton from '../../../../../shared/components/ui/Skeleton';
import { ChargeStatus } from '../../../../../features/finance/services/finance.api';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

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

function ticketStatusClassName(status: Ticket['status']): string {
  const classes: Record<Ticket['status'], string> = {
    OPEN: 'bg-blue-100 text-blue-700 border-blue-200',
    IN_PROGRESS: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    RESOLVED: 'bg-green-100 text-green-700 border-green-200',
    CLOSED: 'bg-muted text-muted-foreground border-border',
  };
  return classes[status] ?? '';
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const SkeletonCard = () => {
  return (
    <Card className="space-y-3">
      <Skeleton height="20px" width="60%" />
      <Skeleton height="14px" width="80%" />
      <Skeleton height="14px" width="40%" />
    </Card>
  );
}

interface StatusCardProps {
  balance: number;
  currency: string;
  lastPaymentDate: string | undefined;
  nextDueDate: string | undefined;
  nextDueAmount: number | undefined;
}

const StatusCard = ({ balance, currency, lastPaymentDate, nextDueDate, nextDueAmount }: StatusCardProps) => {
  const hasDebt = balance > 0;

  return (
    <Card
      className={[
        'flex flex-col gap-3',
        hasDebt
          ? 'border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-800'
          : 'border-green-300 bg-green-50 dark:bg-green-950/20 dark:border-green-800',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        {hasDebt ? (
          <AlertCircle className="text-red-500 mt-0.5 shrink-0" size={22} />
        ) : (
          <CheckCircle2 className="text-green-500 mt-0.5 shrink-0" size={22} />
        )}
        <div className="min-w-0">
          {hasDebt ? (
            <>
              <p className="font-semibold text-red-700 dark:text-red-400 text-base leading-tight">
                Tenés deuda pendiente
              </p>
              <p className="text-2xl font-bold text-red-700 dark:text-red-300 mt-0.5">
                {formatCurrency(balance, currency)}
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold text-green-700 dark:text-green-400 text-base leading-tight">
                Al día ✓
              </p>
              <p className="text-sm text-green-600 dark:text-green-500 mt-0.5">
                Sin saldo pendiente
              </p>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-1 border-t border-current/10">
        <div>
          <p className="text-xs text-muted-foreground">Último pago</p>
          <p className="text-sm font-medium">{formatDate(lastPaymentDate)}</p>
        </div>
        {nextDueDate && (
          <div>
            <p className="text-xs text-muted-foreground">Próx. vencimiento</p>
            <p className="text-sm font-medium">
              {formatDate(nextDueDate)}
              {nextDueAmount !== undefined && (
                <span className="text-muted-foreground ml-1 text-xs">
                  ({formatCurrency(nextDueAmount, currency)})
                </span>
              )}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

interface QuickActionsProps {
  tenantId: string;
}

const QuickActions = ({ tenantId }: QuickActionsProps) => {
  const actions = [
    {
      label: 'Pagar',
      href: `/${tenantId}/resident/payments`,
      icon: <CreditCard size={20} />,
      className: 'bg-primary text-primary-foreground',
    },
    {
      label: 'Comunicados',
      href: `/${tenantId}/resident/announcements`,
      icon: <Bell size={20} />,
      className: 'bg-muted text-foreground border border-border',
    },
    {
      label: 'Nuevo ticket',
      href: `/${tenantId}/resident/tickets`,
      icon: <MessageSquare size={20} />,
      className: 'bg-muted text-foreground border border-border',
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {actions.map((action) => (
        <Link
          key={action.href}
          href={action.href}
          className={[
            'flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-xl',
            'text-sm font-medium transition-opacity active:opacity-70',
            action.className,
          ].join(' ')}
        >
          {action.icon}
          <span className="text-xs leading-tight text-center">{action.label}</span>
        </Link>
      ))}
    </div>
  );
}

interface CommunicationsListProps {
  communications: InboxCommunication[];
  tenantId: string;
}

const CommunicationsList = ({ communications, tenantId }: CommunicationsListProps) => {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold">Comunicados recientes</h2>
        <Link
          href={`/${tenantId}/resident/announcements`}
          className="text-xs text-primary flex items-center gap-0.5 hover:underline"
        >
          Ver todos
          <ChevronRight size={14} />
        </Link>
      </div>

      {communications.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground text-center">
          Sin comunicados recientes
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {communications.map((comm) => (
            <li key={comm.id} className="px-4 py-3 flex items-start gap-3">
              <Bell size={16} className="text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{comm.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge className="bg-muted text-muted-foreground border-border text-xs">
                    {comm.channel}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(comm.sentAt ?? comm.createdAt)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

interface TicketsListProps {
  tickets: Ticket[];
  tenantId: string;
}

const TicketsList = ({ tickets, tenantId }: TicketsListProps) => {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold">Mis tickets recientes</h2>
        <Link
          href={`/${tenantId}/resident/tickets`}
          className="text-xs text-primary flex items-center gap-0.5 hover:underline"
        >
          Ver todos
          <ChevronRight size={14} />
        </Link>
      </div>

      {tickets.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground text-center">
          Sin tickets recientes
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {tickets.map((ticket) => (
            <li key={ticket.id} className="px-4 py-3 flex items-start gap-3">
              <MessageSquare size={16} className="text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{ticket.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge className={ticketStatusClassName(ticket.status)}>
                    {ticketStatusLabel(ticket.status)}
                  </Badge>
                  <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                    <Clock size={11} />
                    {formatDate(ticket.createdAt)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── No-context State ────────────────────────────────────────────────────────

interface NoContextCardProps {
  tenantId: string;
}

const NoContextCard = ({ tenantId }: NoContextCardProps) => {
  return (
    <Card className="flex flex-col items-center gap-3 py-8 text-center">
      <AlertCircle size={32} className="text-muted-foreground" />
      <div>
        <p className="font-semibold text-sm">No hay unidad asignada</p>
        <p className="text-xs text-muted-foreground mt-1">
          Tu cuenta todavía no tiene una unidad activa. Comunicate con la administración.
        </p>
      </div>
      <Link
        href={`/${tenantId}/resident/unit`}
        className="text-sm text-primary hover:underline"
      >
        Ver mi unidad
      </Link>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

const ResidentDashboardPage = () => {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId;
  const session = useAuthSession();
  const userName = session?.user?.name ?? '';

  // 1. Fetch context (to get buildingId + unitId)
  const { data: context, isLoading: contextLoading } = useResidentContext(tenantId ?? null);

  const buildingId = context?.activeBuildingId ?? null;
  const unitId = context?.activeUnitId ?? null;

  // 2. Fetch ledger (requires unitId)
  const { data: ledger, isLoading: ledgerLoading } = useResidentLedger(unitId);

  // 3. Fetch last 3 communications
  const { data: communications = [], isLoading: commsLoading } = useQuery<InboxCommunication[]>({
    queryKey: ['residentCommunications'],
    queryFn: () => getResidentCommunications(3),
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });

  // 4. Fetch last 3 tickets (requires buildingId + unitId)
  const { data: tickets = [], isLoading: ticketsLoading } = useQuery<Ticket[]>({
    queryKey: ['residentTickets', buildingId, unitId],
    queryFn: () => getResidentTickets(buildingId!, unitId!, 3),
    enabled: !!buildingId && !!unitId,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });

  // ── Derived values from ledger ──────────────────────────────────────────
  const balance = ledger?.totals.balance ?? 0;
  const currency = ledger?.payments?.[0]?.currency ?? ledger?.charges?.[0]?.currency ?? 'USD';

  const lastPayment = ledger?.payments
    ?.slice()
    .sort((a, b) => new Date(b.paidAt ?? b.createdAt).getTime() - new Date(a.paidAt ?? a.createdAt).getTime())[0];

  const nextDueCharge = ledger?.charges
    ?.filter((c) => c.status === ChargeStatus.PENDING || c.status === ChargeStatus.PARTIAL)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];

  const isLoading = contextLoading;

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-xl font-semibold">
          {userName ? `Hola, ${userName.split(' ')[0]}` : 'Mi portal'}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Resumen de tu unidad</p>
      </div>

      {/* Top row: Status + Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isLoading || ledgerLoading ? (
          <SkeletonCard />
        ) : !unitId ? (
          <NoContextCard tenantId={tenantId} />
        ) : (
          <StatusCard
            balance={balance}
            currency={currency}
            lastPaymentDate={lastPayment?.paidAt}
            nextDueDate={nextDueCharge?.dueDate}
            nextDueAmount={nextDueCharge?.amount}
          />
        )}
        <QuickActions tenantId={tenantId} />
      </div>

      {/* Bottom row: Communications + Tickets */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {commsLoading ? (
          <SkeletonCard />
        ) : (
          <CommunicationsList communications={communications.slice(0, 3)} tenantId={tenantId} />
        )}
        {ticketsLoading ? (
          <SkeletonCard />
        ) : (
          <TicketsList tickets={tickets.slice(0, 3)} tenantId={tenantId} />
        )}
      </div>
    </div>
  );
};

export default ResidentDashboardPage;
