import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsOptional,
  IsBoolean,
  Min,
  Max,
  IsIn,
  IsArray,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';

export class RecurringExpenseAllocationInputDto {
  @IsString()
  @IsNotEmpty()
  buildingId!: string;

  @IsInt()
  @Min(0)
  @Max(100)
  percentage!: number;
}

export class CreateRecurringExpenseDto {
  @IsOptional()
  @IsString()
  @IsIn(['BUILDING', 'TENANT_SHARED'])
  scopeType?: 'BUILDING' | 'TENANT_SHARED';

  @IsOptional()
  @IsString()
  @IsIn(['MANUAL', 'EQUAL_SHARE', 'BUILDING_TOTAL_M2'])
  allocationMode?: 'MANUAL' | 'EQUAL_SHARE' | 'BUILDING_TOTAL_M2';

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecurringExpenseAllocationInputDto)
  allocations?: RecurringExpenseAllocationInputDto[];

  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @IsInt()
  @Min(1)
  amount!: number;

  @IsString()
  @IsNotEmpty()
  @IsIn(['ARS', 'VES', 'USD'])
  currency!: string;

  @IsString()
  @IsNotEmpty()
  concept!: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['MONTHLY', 'QUARTERLY', 'YEARLY'])
  frequency!: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
}

export class UpdateRecurringExpenseDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  concept?: string;

  @IsOptional()
  @IsString()
  @IsIn(['MANUAL', 'EQUAL_SHARE', 'BUILDING_TOTAL_M2'])
  allocationMode?: 'MANUAL' | 'EQUAL_SHARE' | 'BUILDING_TOTAL_M2';

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecurringExpenseAllocationInputDto)
  allocations?: RecurringExpenseAllocationInputDto[];
}

export interface RecurringExpenseAllocationDto {
  id: string;
  recurringExpenseId: string;
  buildingId: string;
  percentage: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecurringExpenseDto {
  id: string;
  tenantId: string;
  buildingId: string | null;
  scopeType: string;
  allocationMode: string | null;
  categoryId: string;
  amount: number;
  currency: string;
  concept: string;
  frequency: string;
  nextRunDate: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
