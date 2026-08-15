import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IncomeApplicationDestination } from '@prisma/client';

export const MAX_APPLICATIONS_PER_PLAN = 20;

export class IncomeApplicationInputDto {
  @IsEnum(IncomeApplicationDestination)
  destinationType!: IncomeApplicationDestination;

  @IsString()
  @IsOptional()
  fundId?: string;

  @IsInt()
  @Min(1)
  amountMinor!: number;
}

export class CreateIncomeApplicationsDto {
  @IsArray()
  @ArrayNotEmpty()
  @Max(MAX_APPLICATIONS_PER_PLAN)
  @ValidateNested({ each: true })
  @Type(() => IncomeApplicationInputDto)
  applications!: IncomeApplicationInputDto[];
}

export interface IncomeApplicationResponseDto {
  id: string;
  tenantId: string;
  incomeId: string;
  destinationType: IncomeApplicationDestination;
  fundId: string | null;
  amountMinor: number;
  currencyCode: string;
  fundTransactionId: string | null;
  createdAt: Date;
}

export interface IncomeApplicationPlanResponseDto {
  incomeId: string;
  currencyCode: string;
  totalAmountMinor: number;
  applications: IncomeApplicationResponseDto[];
}
