import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsBoolean,
  Min,
  IsIn,
} from 'class-validator';

export class CreateRecurringExpenseDto {
  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @IsNumber()
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
  @IsNumber()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  concept?: string;
}

export interface RecurringExpenseDto {
  id: string;
  tenantId: string;
  buildingId: string;
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
