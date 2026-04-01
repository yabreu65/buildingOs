import {
  IsString,
  IsOptional,
  IsInt,
  IsISO8601,
  IsBoolean,
  MinLength,
  Min,
  Length,
  Matches,
} from 'class-validator';

// ── ExpenseLedgerCategory ──────────────────────────────────────────────────

export class CreateExpenseLedgerCategoryDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;
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
  active?: boolean;
}

export interface ExpenseLedgerCategoryResponseDto {
  id: string;
  tenantId: string;
  code: string | null;
  name: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ── Expense ────────────────────────────────────────────────────────────────

export class CreateExpenseDto {
  @IsString()
  buildingId!: string;

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
  buildingId: string;
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
