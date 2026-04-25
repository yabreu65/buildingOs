import { apiClient } from '@/shared/lib/http/client';

export enum DashboardPeriod {
  CURRENT_MONTH = 'CURRENT_MONTH',
  PREVIOUS_MONTH = 'PREVIOUS_MONTH',
  LAST_30_DAYS = 'LAST_30_DAYS',
}

export interface TicketSummary {
  id: string;
  title: string;
  status: string;
  buildingId: string;
  buildingName: string;
  createdAt: string;
}

export interface PaymentToValidateSummary {
  id: string;
  unitLabel: string;
  buildingName: string;
  amount: number;
  submittedAt: string;
}

export interface UnitWithoutResponsibleSummary {
  unitId: string;
  unitLabel: string;
  buildingId: string;
  buildingName: string;
}

export interface BuildingAlert {
  buildingId: string;
  buildingName: string;
  outstandingAmount: number;
  overdueTickets: number;
  unitsWithoutResponsible: number;
  riskScore: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface DashboardKpis {
  outstandingAmount: number | null;
  collectedAmount: number | null;
  collectionRate: number | null;
  delinquentUnits: number | null;
}

export interface DashboardQueues {
  tickets: {
    open: number;
    inProgress: number;
    closed: number;
    overdue: number;
    top: TicketSummary[];
  };
  paymentsToValidate: {
    count: number;
    top: PaymentToValidateSummary[];
  };
  unitsWithoutResponsible: {
    count: number;
    top: UnitWithoutResponsibleSummary[];
  };
}

export interface DashboardSummary {
  kpis: DashboardKpis;
  queues: DashboardQueues;
  buildingAlerts: BuildingAlert[];
  quickActions: string[];
  metadata: {
    period: string;
    buildingId: string | null;
    generatedAt: string;
  };
}

export interface DashboardQuery {
  period?: DashboardPeriod;
  periodMonth?: string;
  buildingId?: string;
}

export interface DebtSummaryQuery {
  buildingId?: string;
  lastMonths?: number;
  excludeCurrent?: boolean;
}

export interface DebtSummaryResponse {
  periods: string[];
  debtByPeriod: Record<string, number>;
  totalDebt: number;
}

export interface DebtAgingQuery {
  asOf?: string;
  buildingId?: string;
}

export interface DebtByPeriodQuery {
  asOf?: string;
  buildingId?: string;
}

export interface DebtAgingBuckets {
  '0_30': number;
  '31_60': number;
  '61_90': number;
  '90_plus': number;
}

export interface DebtAgingResponsible {
  memberId: string;
  name: string;
  role: string;
}

export interface DebtAgingWorstCase {
  unitId: string;
  unitLabel: string;
  period: string;
  dueDate: string;
  outstanding: number;
}

export interface DebtAgingRow {
  unitId: string;
  buildingId: string;
  unitLabel: string;
  responsable: DebtAgingResponsible | null;
  overdueTotal: number;
  bucket: keyof DebtAgingBuckets;
  oldestUnpaidDueDate: string;
  oldestUnpaidPeriod: string;
  lastPaymentDate: string | null;
}

export interface DebtAgingResponse {
  asOf: string;
  totalOverdue: number;
  unitsMorosas: number;
  buckets: DebtAgingBuckets;
  worstCase: DebtAgingWorstCase | null;
  rowsByUnit: DebtAgingRow[];
}

export interface DebtByPeriodPeriod {
  period: string;
  dueDate: string;
  charged: number;
  allocatedPaid: number;
  outstanding: number;
}

export interface DebtByPeriodRow {
  unitId: string;
  buildingId: string;
  unitLabel: string;
  responsable: DebtAgingResponsible | null;
  totalOverdue: number;
  periods: DebtByPeriodPeriod[];
  oldestUnpaidPeriod: string;
  oldestUnpaidDueDate: string;
  lastPaymentDate: string | null;
}

export interface DebtByPeriodResponse {
  asOf: string;
  rowsByUnit: DebtByPeriodRow[];
}

export async function getDashboardSummary(
  tenantId: string,
  query: DashboardQuery = {},
): Promise<DashboardSummary> {
  const params = new URLSearchParams();
  if (query.period) params.append('period', query.period);
  if (query.periodMonth) params.append('periodMonth', query.periodMonth);
  if (query.buildingId) params.append('buildingId', query.buildingId);

  const queryString = params.toString();
  return apiClient<DashboardSummary>({
    path: `/tenants/${tenantId}/dashboard/admin${queryString ? `?${queryString}` : ''}`,
    method: 'GET',
  });
}

export async function getDebtSummary(
  tenantId: string,
  query: DebtSummaryQuery = {},
): Promise<DebtSummaryResponse> {
  const params = new URLSearchParams();
  params.append('lastMonths', String(query.lastMonths ?? 3));
  params.append('excludeCurrent', String(query.excludeCurrent ?? true));
  if (query.buildingId) params.append('buildingId', query.buildingId);

  return apiClient<DebtSummaryResponse>({
    path: `/tenants/${tenantId}/reports/debt/summary?${params.toString()}`,
    method: 'GET',
  });
}

export async function getDebtAging(
  tenantId: string,
  query: DebtAgingQuery = {},
): Promise<DebtAgingResponse> {
  const params = new URLSearchParams();
  if (query.asOf) params.append('asOf', query.asOf);
  if (query.buildingId) params.append('buildingId', query.buildingId);

  const queryString = params.toString();
  return apiClient<DebtAgingResponse>({
    path: `/tenants/${tenantId}/reports/debt/aging${queryString ? `?${queryString}` : ''}`,
    method: 'GET',
  });
}

export async function getDebtByPeriod(
  tenantId: string,
  query: DebtByPeriodQuery = {},
): Promise<DebtByPeriodResponse> {
  const params = new URLSearchParams();
  if (query.asOf) params.append('asOf', query.asOf);
  if (query.buildingId) params.append('buildingId', query.buildingId);

  const queryString = params.toString();
  return apiClient<DebtByPeriodResponse>({
    path: `/tenants/${tenantId}/reports/debt/by-period${queryString ? `?${queryString}` : ''}`,
    method: 'GET',
  });
}

export const dashboardApi = {
  getSummary: getDashboardSummary,
  getDebtSummary,
  getDebtAging,
  getDebtByPeriod,
};
