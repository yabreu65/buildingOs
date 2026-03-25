import { IsString, IsOptional, IsInt, IsPositive, IsDateString, Min, Max } from 'class-validator';
import { ExpensePeriodStatus } from '@prisma/client';
import { BuildingParamDto } from '../common/dtos/params.dto';

// ============================================================================
// EXPENSE PERIOD DTOs
// ============================================================================

export class CreateExpensePeriodDto {
  @IsInt()
  @Min(2000)
  @Max(2999)
  year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @IsInt()
  @IsPositive()
  totalToAllocate!: number; // In cents

  @IsOptional()
  @IsString()
  currency?: string; // Default: ARS

  @IsDateString()
  dueDate!: string;

  @IsString()
  concept!: string; // e.g., "Expensas Comunes - Enero 2026"
}

export class UpdateExpensePeriodDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  totalToAllocate?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  concept?: string;
}

export class GenerateExpensePeriodDto {
  // No fields — just trigger generation
}

export class PublishExpensePeriodDto {
  // No fields — just trigger publish
}

// ============================================================================
// RESPONSE DTOs
// ============================================================================

export interface ExpensePeriodDto {
  id: string;
  tenantId: string;
  buildingId: string;
  year: number;
  month: number;
  totalToAllocate: number;
  currency: string;
  dueDate: Date;
  concept: string;
  status: ExpensePeriodStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GenerateResultDto {
  chargesCount: number;
  totalAllocated: number; // Should equal totalToAllocate
}

export interface ExpensePeriodDetailDto extends ExpensePeriodDto {
  charges: Array<{
    id: string;
    unitId: string;
    unitCode: string;
    unitLabel: string | null;
    amount: number;
    status: string;
    coefficientSnapshot: number | null;
    categorySnapshotId: string | null;
  }>;
}

export interface BlockedGenerationErrorDto {
  message: string;
  reason: string; // "allocation_mode_disabled" | "units_without_category" | "period_exists" | etc.
  unitsWithoutCategory?: Array<{
    id: string;
    code: string;
    label: string | null;
  }>;
}

// ============================================================================
// PARAM DTOs
// ============================================================================

export class CreateExpensePeriodParamDto extends BuildingParamDto {}
export class ListExpensePeriodsParamDto extends BuildingParamDto {}
export class GetExpensePeriodParamDto extends BuildingParamDto {
  @IsString()
  periodId!: string;
}
export class UpdateExpensePeriodParamDto extends BuildingParamDto {
  @IsString()
  periodId!: string;
}
export class DeleteExpensePeriodParamDto extends BuildingParamDto {
  @IsString()
  periodId!: string;
}
export class GenerateExpensePeriodParamDto extends BuildingParamDto {
  @IsString()
  periodId!: string;
}
export class PublishExpensePeriodParamDto extends BuildingParamDto {
  @IsString()
  periodId!: string;
}

// ============================================================================
// QUERY DTOs
// ============================================================================

export class ListExpensePeriodsQueryDto {
  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2999)
  year?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @IsString()
  status?: ExpensePeriodStatus;

  @IsOptional()
  @IsInt()
  limit?: number;

  @IsOptional()
  @IsInt()
  offset?: number;
}
