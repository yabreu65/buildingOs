import { IsOptional, IsString, IsEnum, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum DashboardPeriod {
  CURRENT_MONTH = 'CURRENT_MONTH',
  PREVIOUS_MONTH = 'PREVIOUS_MONTH',
  LAST_30_DAYS = 'LAST_30_DAYS',
}

export class DashboardQueryDto {
  @ApiPropertyOptional({
    enum: DashboardPeriod,
    default: DashboardPeriod.CURRENT_MONTH,
  })
  @IsOptional()
  @IsEnum(DashboardPeriod)
  period?: DashboardPeriod = DashboardPeriod.CURRENT_MONTH;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  buildingId?: string;
}

export type TicketSummary = {
  id: string;
  title: string;
  status: string;
  buildingId: string;
  buildingName: string;
  createdAt: string;
};

export type PaymentToValidateSummary = {
  id: string;
  unitLabel: string;
  buildingName: string;
  amount: number;
  submittedAt: string;
};

export type UnitWithoutResponsibleSummary = {
  unitId: string;
  unitLabel: string;
  buildingId: string;
  buildingName: string;
};

export type BuildingAlert = {
  buildingId: string;
  buildingName: string;
  outstandingAmount: number;
  overdueTickets: number;
  unitsWithoutResponsible: number;
  riskScore: 'HIGH' | 'MEDIUM' | 'LOW';
};

export type DashboardKpis = {
  outstandingAmount: number | null;
  collectedAmount: number | null;
  collectionRate: number | null;
  delinquentUnits: number | null;
};

export type DashboardQueues = {
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
};

export type DashboardSummaryDto = {
  kpis: DashboardKpis;
  queues: DashboardQueues;
  buildingAlerts: BuildingAlert[];
  quickActions: string[];
  metadata: {
    period: string;
    buildingId: string | null;
    generatedAt: string;
    moduleStatus?: 'FINANCIAL_MODULE_OK' | 'FINANCIAL_MODULE_DISABLED';
  };
};
