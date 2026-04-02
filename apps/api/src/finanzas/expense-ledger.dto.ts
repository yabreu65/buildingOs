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
} from 'class-validator';
import { Type } from 'class-transformer';

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
  movementType?: 'EXPENSE' | 'INCOME'; // default EXPENSE if not provided
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
}

export interface ExpenseLedgerCategoryResponseDto {
  id: string;
  tenantId: string;
  code: string | null;
  name: string;
  description: string | null;
  movementType: 'EXPENSE' | 'INCOME';
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
  @Matches(/^\d{4}-\d{2}$/, { message: 'period must be in YYYY-MM format' })
  period!: string;

  @IsString()
  @Length(3, 3)
  baseCurrency!: string;
}

export class PublishLiquidationDto {
  @IsISO8601()
  dueDate!: string;
}

export interface LiquidationResponseDto {
  id: string;
  tenantId: string;
  buildingId: string;
  period: string;
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
