import {
  IsString,
  IsOptional,
  IsInt,
  IsEnum,
  Min,
  MinLength,
  MaxLength,
  IsDateString,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CANONICAL_CURRENCIES, type CanonicalCurrency } from '@buildingos/contracts';
import {
  FundScopeType,
  FundType,
  FundStatus,
  FundTransactionDirection,
} from '@prisma/client';

// ── Fund ────────────────────────────────────────────────────────────────────

export class CreateFundDto {
  @IsEnum(FundScopeType)
  scopeType!: FundScopeType;

  @IsString()
  @IsOptional()
  @ValidateIf((dto: CreateFundDto) => dto.scopeType === FundScopeType.BUILDING)
  buildingId?: string;

  @IsEnum(FundType)
  type!: FundType;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;
}

export class UpdateFundDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;
}

export class FundQueryDto {
  @IsString()
  @IsOptional()
  buildingId?: string;

  @IsEnum(FundScopeType)
  @IsOptional()
  scopeType?: FundScopeType;

  @IsEnum(FundStatus)
  @IsOptional()
  status?: FundStatus;
}

export interface FundResponseDto {
  id: string;
  tenantId: string;
  buildingId: string | null;
  scopeType: FundScopeType;
  type: FundType;
  name: string;
  description: string | null;
  status: FundStatus;
  balancesByCurrency: Array<{ currency: string; amountMinor: number }>;
  createdAt: Date;
  archivedAt: Date | null;
}

// ── FundTransaction ─────────────────────────────────────────────────────────

export class CreateFundTransactionDto {
  @IsEnum(FundTransactionDirection)
  direction!: FundTransactionDirection;

  @IsInt()
  @Min(1)
  amountMinor!: number;

  @IsEnum(CANONICAL_CURRENCIES, {
    message: 'currency must be one of USD, VES, ARS, or COP',
  })
  currencyCode!: CanonicalCurrency;

  @IsDateString()
  occurredAt!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  idempotencyKey?: string;
}

export class ReverseFundTransactionDto {
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}

export class FundTransactionQueryDto {
  @IsString()
  @IsOptional()
  currencyCode?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  offset?: number;
}

export interface FundTransactionResponseDto {
  id: string;
  tenantId: string;
  fundId: string;
  direction: FundTransactionDirection;
  amountMinor: number;
  currencyCode: string;
  occurredAt: Date;
  description: string | null;
  idempotencyKey: string | null;
  reversalOfTransactionId: string | null;
  incomeApplicationId: string | null;
  createdAt: Date;
}
