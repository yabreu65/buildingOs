import {
  IsString,
  IsOptional,
  IsInt,
  IsISO8601,
  IsBoolean,
  IsEnum,
  IsArray,
  ValidateNested,
  MinLength,
  Min,
  Length,
  Matches,
  ValidateIf,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { MovementType } from '@prisma/client';

export type ExpenseLedgerCategoryMovementType = 'EXPENSE' | 'INCOME';
export type ExpenseLedgerCategoryCatalogScope = 'BUILDING' | 'CONDOMINIUM_COMMON';

// ── Movement Allocation ────────────────────────────────────────────────────

export class AllocationInputDto {
  @IsString()
  buildingId!: string;

  @IsInt()
  @IsOptional()
  @Min(0)
  percentage?: number; // 0-100

  @IsInt()
  @IsOptional()
  @Min(0)
  amountMinor?: number; // in smallest currency unit

  @IsString()
  @IsOptional()
  @Length(3, 3)
  currencyCode?: string;
}

// ── ExpenseLedgerCategory ──────────────────────────────────────────────────

export class CreateExpenseLedgerCategoryDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  @IsEnum(MovementType)
  movementType?: ExpenseLedgerCategoryMovementType; // default EXPENSE if not provided

  @IsEnum(['BUILDING', 'CONDOMINIUM_COMMON'])
  @IsOptional()
  catalogScope?: ExpenseLedgerCategoryCatalogScope; // default BUILDING if not provided
}

export class UpdateExpenseLedgerCategoryDto {
  @IsString()
  @MinLength(2)
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsEnum(['BUILDING', 'CONDOMINIUM_COMMON'])
  @IsOptional()
  catalogScope?: ExpenseLedgerCategoryCatalogScope;
}

export class ExpenseLedgerCategoryQueryDto {
  @IsOptional()
  @IsEnum(MovementType, { message: 'movementType must be EXPENSE or INCOME' })
  movementType?: ExpenseLedgerCategoryMovementType;

  @IsOptional()
  @Matches(/^(BUILDING|CONDOMINIUM_COMMON)$/, {
    message: 'catalogScope must be BUILDING or CONDOMINIUM_COMMON',
  })
  catalogScope?: ExpenseLedgerCategoryCatalogScope;
}

export class ExpenseLedgerCategoryParamDto {
  @IsString()
  @Matches(/^c[0-9a-z]{24}$/)
  categoryId!: string;
}

export interface ExpenseLedgerCategoryResponseDto {
  id: string;
  tenantId: string;
  code: string | null;
  name: string;
  description: string | null;
  movementType: 'EXPENSE' | 'INCOME';
  catalogScope: 'BUILDING' | 'CONDOMINIUM_COMMON';
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ── Expense ────────────────────────────────────────────────────────────────

export class CreateExpenseDto {
  @IsString()
  @IsOptional()
  buildingId?: string; // Optional for TENANT_SHARED scope

  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'period must be in YYYY-MM format' })
  period!: string;

  @IsString()
  categoryId!: string;

  @IsString()
  @IsOptional()
  vendorId?: string;

  @IsInt()
  @Min(1)
  amountMinor!: number;

  @IsString()
  @Length(3, 3)
  currencyCode!: string;

  @IsISO8601()
  invoiceDate!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  attachmentFileKey?: string;

  @IsEnum(['BUILDING', 'TENANT_SHARED', 'UNIT_GROUP'])
  @IsOptional()
  scopeType?: 'BUILDING' | 'TENANT_SHARED' | 'UNIT_GROUP'; // default: BUILDING

  @IsString()
  @IsOptional()
  unitGroupId?: string; // Required if scopeType='UNIT_GROUP'

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllocationInputDto)
  @IsOptional()
  allocations?: AllocationInputDto[]; // Required if scopeType='TENANT_SHARED' or 'UNIT_GROUP'
}

export class UpdateExpenseDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  amountMinor?: number;

  @IsString()
  @Length(3, 3)
  @IsOptional()
  currencyCode?: string;

  @IsISO8601()
  @IsOptional()
  invoiceDate?: string;

  @IsString()
  @IsOptional()
  categoryId?: string;

  @IsString()
  @IsOptional()
  vendorId?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  attachmentFileKey?: string;
}

export interface ExpenseResponseDto {
  id: string;
  tenantId: string;
  buildingId: string | null;
  period: string;
  liquidationPeriod?: string | null;
  categoryId: string;
  categoryName: string;
  vendorId: string | null;
  vendorName: string | null;
  amountMinor: number;
  currencyCode: string;
  invoiceDate: Date;
  description: string | null;
  attachmentFileKey: string | null;
  status: 'DRAFT' | 'VALIDATED' | 'VOID';
  scopeType: 'BUILDING' | 'TENANT_SHARED' | 'UNIT_GROUP';
  unitGroupId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Liquidation ────────────────────────────────────────────────────────────

export class CreateLiquidationDraftDto {
  @IsString()
  buildingId!: string;

  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'period must be in YYYY-MM format',
  })
  period!: string;

  @IsString()
  @Length(3, 3)
  baseCurrency!: string;
}

export class PublishLiquidationDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsStrictDateString({ message: 'dueDate must be a valid YYYY-MM-DD date' })
  dueDate!: string;
}

export class CancelLiquidationDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  reason?: string;
}

export class ListLiquidationsQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'period must be in YYYY-MM format',
  })
  period?: string;

  @IsOptional()
  @IsString()
  buildingId?: string;
}

export class LiquidationParamDto {
  @IsString()
  @Matches(/^c[0-9a-z]{24}$/)
  liquidationId!: string;
}

function IsStrictDateString(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'IsStrictDateString',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          if (typeof value !== 'string') {
            return false;
          }

          if (value.trim() !== value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return false;
          }

          const date = new Date(`${value}T00:00:00.000Z`);
          return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
        },
        defaultMessage(validationArguments?: ValidationArguments): string {
          return `${validationArguments?.property ?? 'value'} must be a valid YYYY-MM-DD date`;
        },
      },
    });
  };
}

export interface LiquidationResponseDto {
  id: string;
  tenantId: string;
  buildingId: string;
  period: string;
  chargePeriod?: string | null;
  status: 'DRAFT' | 'REVIEWED' | 'PUBLISHED' | 'CANCELED';
  baseCurrency: string;
  totalAmountMinor: number;
  totalsByCurrency: Record<string, number>;
  unitCount: number;
  generatedAt: Date;
  reviewedAt: Date | null;
  publishedAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
}

export interface LiquidationDetailDto extends LiquidationResponseDto {
  publicationSnapshotStatus: 'AVAILABLE' | 'LEGACY';
  expenses: Array<{
    id: string;
    categoryName: string;
    vendorName: string | null;
    amountMinor: number;
    currencyCode: string;
    invoiceDate: Date;
    description: string | null;
  }>;
  chargesPreview: Array<{
    unitId: string;
    unitCode: string;
    unitLabel: string | null;
    amountMinor: number;
  }>;
}

// ── Income ─────────────────────────────────────────────────────────────────

export class CreateIncomeDto {
  @IsString()
  @IsOptional()
  buildingId?: string; // Optional: null for tenant-level, set for building-level

  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'period must be in YYYY-MM format' })
  period!: string;

  @IsString()
  categoryId!: string; // Must reference INCOME type category

  @IsInt()
  @Min(1)
  amountMinor!: number;

  @IsString()
  @Length(3, 3)
  currencyCode!: string;

  @IsISO8601()
  receivedDate!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  attachmentFileKey?: string;

  @IsEnum(['BUILDING', 'TENANT_SHARED', 'UNIT_GROUP'])
  @IsOptional()
  scopeType?: 'BUILDING' | 'TENANT_SHARED' | 'UNIT_GROUP'; // default: BUILDING

  @IsEnum(['APPLY_TO_EXPENSES', 'RESERVE_FUND', 'SPECIAL_FUND'])
  @IsOptional()
  destination?: 'APPLY_TO_EXPENSES' | 'RESERVE_FUND' | 'SPECIAL_FUND'; // default: APPLY_TO_EXPENSES

  @IsString()
  @IsOptional()
  unitGroupId?: string; // Required if scopeType='UNIT_GROUP'

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllocationInputDto)
  @IsOptional()
  allocations?: AllocationInputDto[]; // Required if scopeType='TENANT_SHARED' or 'UNIT_GROUP'
}

export class UpdateIncomeDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  amountMinor?: number;

  @IsString()
  @Length(3, 3)
  @IsOptional()
  currencyCode?: string;

  @IsISO8601()
  @IsOptional()
  receivedDate?: string;

  @IsString()
  @IsOptional()
  categoryId?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  attachmentFileKey?: string;
}

export interface IncomeResponseDto {
  id: string;
  tenantId: string;
  buildingId: string | null;
  period: string;
  categoryId: string;
  categoryName: string;
  amountMinor: number;
  currencyCode: string;
  receivedDate: Date;
  description: string | null;
  attachmentFileKey: string | null;
  status: 'DRAFT' | 'RECORDED' | 'VOID';
  scopeType: 'BUILDING' | 'TENANT_SHARED' | 'UNIT_GROUP';
  destination: 'APPLY_TO_EXPENSES' | 'RESERVE_FUND' | 'SPECIAL_FUND';
  unitGroupId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Adjustment (Retroactive adjustments) ──────────────────────────────────────

export class CreateAdjustmentDto {
  @IsString()
  buildingId!: string;

  @IsISO8601()
  sourceInvoiceDate!: string;

  @IsString()
  categoryId!: string;

  @IsInt()
  @Min(1)
  amountMinor!: number;

  @IsString()
  @Length(3, 3)
  currencyCode!: string;

  @IsString()
  @MinLength(5)
  reason!: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'targetPeriod must be in YYYY-MM format' })
  targetPeriod?: string;
}

export interface AdjustmentResponseDto {
  id: string;
  tenantId: string;
  buildingId: string;
  sourceInvoiceDate: Date;
  sourcePeriod: string;
  targetPeriod: string;
  categoryId: string;
  categoryName: string;
  amountMinor: number;
  currencyCode: string;
  reason: string;
  status: 'DRAFT' | 'VALIDATED' | 'VOIDED';
  createdByMembershipId: string;
  validatedByMembershipId: string | null;
  validatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Error with suggestion for retroactivos ────────────────────────────────────

export class PeriodPublishedErrorDto {
  code: 'PERIOD_PUBLISHED' = 'PERIOD_PUBLISHED';
  message!: string;
  publishedPeriod!: string;
  suggestedTargetPeriod!: string;
  canCreateAdjustment!: boolean;
}
