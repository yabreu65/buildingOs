import { IsString, IsOptional, IsInt, IsPositive, IsEnum, IsDateString, Min, Max } from 'class-validator';
import { ChargeType, ChargeStatus, PaymentStatus, PaymentMethod } from '@prisma/client';
import {
  BuildingChargeParamDto,
  BuildingPaymentParamDto,
  BuildingAllocationParamDto,
  BuildingParamDto,
} from '../common/dtos/params.dto';

// ============================================================================
// CHARGE DTOs
// ============================================================================

export class CreateChargeDto {
  @IsString()
  unitId!: string;

  @IsEnum(ChargeType)
  type!: ChargeType;

  @IsString()
  concept!: string;

  @IsInt()
  @IsPositive()
  amount!: number; // In cents

  @IsOptional()
  @IsString()
  currency?: string; // Default: ARS

  @IsOptional()
  @IsString()
  period?: string; // YYYY-MM format, default: current month

  @IsDateString()
  dueDate!: string;

  @IsOptional()
  @IsString()
  createdByMembershipId?: string;
}

export class UpdateChargeDto {
  @IsOptional()
  @IsEnum(ChargeType)
  type?: ChargeType;

  @IsOptional()
  @IsString()
  concept?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

export class CancelChargeDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

// ============================================================================
// PAYMENT DTOs
// ============================================================================

export class SubmitPaymentDto {
  @IsOptional()
  @IsString()
  unitId?: string;

  @IsInt()
  @IsPositive()
  amount!: number; // In cents

  @IsOptional()
  @IsString()
  currency?: string; // Default: ARS

  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  proofFileId?: string;
}

export class ApprovePaymentDto {
  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RejectPaymentDto {
  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RevivePaymentParamDto extends BuildingPaymentParamDto {}

export class GetPaymentParamDto extends BuildingPaymentParamDto {}

export class CancelPaymentParamDto extends BuildingPaymentParamDto {}

export class CancelPaymentDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

// ============================================================================
// ALLOCATION DTOs
// ============================================================================

export class CreateAllocationDto {
  @IsString()
  paymentId!: string;

  @IsString()
  chargeId!: string;

  @IsInt()
  @IsPositive()
  amount!: number; // In cents (must be <= remaining payment amount)
}

export class UpdateAllocationDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  amount?: number;
}

// ============================================================================
// QUERY DTOs
// ============================================================================

export class PaymentMetricsQueryDto {
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  buildingId?: string;
}

export class PaymentMetricsDto {
  backlogCount!: number;
  backlogAmount!: number;
  agingMedianDays!: number;
  agingP95Days!: number;
  totalReviewed!: number;
  approvalRate!: number;
  rejectionRate!: number;
  rejectionReasons!: Array<{ reason: string; count: number }>;
  byBuilding!: Array<{
    buildingId: string;
    buildingName: string;
    pending: number;
    pendingAmount: number;
    approved: number;
    rejected: number;
  }>;
}

export class ListPendingPaymentsQueryDto {
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @IsOptional()
  @IsString()
  buildingId?: string;

  @IsOptional()
  @IsString()
  unitId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class ListChargesQueryDto {
  @IsOptional()
  @IsString()
  period?: string; // YYYY-MM format

  @IsOptional()
  @IsEnum(ChargeStatus)
  status?: ChargeStatus;

  @IsOptional()
  @IsString()
  unitId?: string;

  @IsOptional()
  @IsInt()
  limit?: number;

  @IsOptional()
  @IsInt()
  offset?: number;
}

export class ListPaymentsQueryDto {
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @IsOptional()
  @IsString()
  unitId?: string;

  @IsOptional()
  @IsInt()
  limit?: number;

  @IsOptional()
  @IsInt()
  offset?: number;
}

// ============================================================================
// RESPONSE DTOs (informational - use as types, not classes)
// ============================================================================

export interface ChargeDetailDto {
  id: string;
  tenantId: string;
  buildingId: string;
  building?: {
    id: string;
    name: string;
  };
  unitId: string;
  unit?: {
    id: string;
    label: string;
  };
  period: string;
  type: ChargeType;
  concept: string;
  amount: number;
  currency: string;
  dueDate: Date;
  status: ChargeStatus;
  createdAt: Date;
  updatedAt: Date;
  canceledAt: Date | null;
  createdByMembershipId: string | null;
}

export interface PaymentDetailDto {
  id: string;
  tenantId: string;
  buildingId: string;
  building?: {
    id: string;
    name: string;
  };
  unitId: string | null;
  unit?: {
    id: string;
    label: string;
  };
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt: Date | null;
  reference: string | null;
  createdAt: Date;
  updatedAt: Date;
  proofFileId: string | null;
  createdByUserId: string;
  reviewedByMembershipId: string | null;
}

export interface FinancialSummaryDto {
  totalCharges: number;
  totalPaid: number;
  totalOutstanding: number;
  delinquentUnitsCount: number;
  topDelinquentUnits: Array<{
    unitId: string;
    unitLabel: string;
    buildingId: string;
    buildingName: string;
    outstanding: number;
  }>;
  currency: string;
}

export interface UnitLedgerDto {
  unitId: string;
  unitLabel: string;
  buildingId: string;
  buildingName: string;
  charges: Array<{
    id: string;
    period: string;
    concept: string;
    amount: number;
    type: ChargeType;
    status: ChargeStatus;
    dueDate: Date;
    allocated: number;
  }>;
  payments: Array<{
    id: string;
    amount: number;
    method: PaymentMethod;
    status: PaymentStatus;
    createdAt: Date;
    allocated: number;
  }>;
  totals: {
    totalCharges: number;
    totalAllocated: number;
    balance: number;
    currency: string;
  };
}

// ============================================================================
// PARAM DTOs (extend base DTOs)
// ============================================================================

export class GetChargeParamDto extends BuildingChargeParamDto {}
export class UpdateChargeParamDto extends BuildingChargeParamDto {}
export class DeleteChargeParamDto extends BuildingChargeParamDto {}

export class GetPaymentAllocationsParamDto extends BuildingPaymentParamDto {}
export class ApprovePaymentParamDto extends BuildingPaymentParamDto {}
export class RejectPaymentParamDto extends BuildingPaymentParamDto {}

export class DeleteAllocationParamDto extends BuildingAllocationParamDto {}

export class ListChargesParamDto extends BuildingParamDto {}
export class CreateChargeParamDto extends BuildingParamDto {}
export class ListPaymentsParamDto extends BuildingParamDto {}
export class CreatePaymentParamDto extends BuildingParamDto {}
export class CreateAllocationParamDto extends BuildingParamDto {}
export class FinancialSummaryParamDto extends BuildingParamDto {}

// ============================================================================
// FINANCIAL SUMMARY QUERY DTO
// ============================================================================

export class FinancialSummaryQueryDto {
  @IsOptional()
  @IsString()
  period?: string;
}

// ============================================================================
// FINANCIAL TREND DTOs
// ============================================================================

export interface MonthlyTrendDto {
  period: string;           // "YYYY-MM"
  totalCharges: number;
  totalPaid: number;
  totalOutstanding: number;
  collectionRate: number;   // 0-100
}

export class FinanceTrendQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  months?: number;  // default: 6
}

// ============================================================================
// PAYMENT AUDIT & DUPLICATE DTOs
// ============================================================================

export class PaymentAuditLogDto {
  id!: string;
  tenantId!: string;
  paymentId!: string;
  action!: string;
  membershipId?: string;
  reason?: string;
  comment?: string;
  metadata?: Record<string, unknown>;
  createdAt!: Date;
}

export class PaymentDuplicateCheckResultDto {
  hasDuplicate!: boolean;
  duplicatePaymentId?: string;
  duplicateAmount?: number;
  duplicateReference?: string;
  duplicateCreatedAt?: Date;
}

export class GetPaymentAuditLogQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}
