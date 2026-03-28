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
  buildingId?: string;
}

export async function getDashboardSummary(
  query: DashboardQuery = {},
): Promise<DashboardSummary> {
  const params = new URLSearchParams();
  if (query.period) params.append('period', query.period);
  if (query.buildingId) params.append('buildingId', query.buildingId);

  const queryString = params.toString();
  return apiClient<DashboardSummary>({
    path: `/dashboard/admin${queryString ? `?${queryString}` : ''}`,
    method: 'GET',
  });
}

export const dashboardApi = {
  getSummary: getDashboardSummary,
};
