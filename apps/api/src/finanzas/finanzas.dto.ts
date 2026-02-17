import { IsString, IsOptional, IsInt, IsPositive, IsDate, IsEnum, IsDateString } from 'class-validator';
import { ChargeType, ChargeStatus, PaymentStatus, PaymentMethod } from '@prisma/client';

// ============================================================================
// CHARGE DTOs
// ============================================================================

export class CreateChargeDto {
  @IsString()
  unitId: string;

  @IsEnum(ChargeType)
  type: ChargeType;

  @IsString()
  concept: string;

  @IsInt()
  @IsPositive()
  amount: number; // In cents

  @IsOptional()
  @IsString()
  currency?: string; // Default: ARS

  @IsOptional()
  @IsString()
  period?: string; // YYYY-MM format, default: current month

  @IsDateString()
  dueDate: string;

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
  amount: number; // In cents

  @IsOptional()
  @IsString()
  currency?: string; // Default: ARS

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

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
  reason: string;
}

// ============================================================================
// ALLOCATION DTOs
// ============================================================================

export class CreateAllocationDto {
  @IsString()
  paymentId: string;

  @IsString()
  chargeId: string;

  @IsInt()
  @IsPositive()
  amount: number; // In cents (must be <= remaining payment amount)
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
// RESPONSE DTOs (informational)
// ============================================================================

export class ChargeDetailDto {
  id: string;
  tenantId: string;
  buildingId: string;
  unitId: string;
  period: string;
  type: ChargeType;
  concept: string;
  amount: number;
  currency: string;
  dueDate: Date;
  status: ChargeStatus;
  createdAt: Date;
  updatedAt: Date;
  canceledAt?: Date;
}

export class PaymentDetailDto {
  id: string;
  tenantId: string;
  buildingId: string;
  unitId?: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  paidAt?: Date;
  reference?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class FinancialSummaryDto {
  totalCharges: number;
  totalPaid: number;
  totalOutstanding: number;
  delinquentUnitsCount: number;
  topDelinquentUnits: Array<{
    unitId: string;
    outstanding: number;
  }>;
  currency: string;
}

export class UnitLedgerDto {
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
