import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export const ISO_LOCAL_DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Query params for debt aging report.
 */
export class DebtAgingQueryDto {
  @ApiPropertyOptional({
    description: 'Debt cut date in YYYY-MM-DD format',
    example: '2026-04-19',
  })
  @IsOptional()
  @IsString()
  @Matches(ISO_LOCAL_DATE_REGEX)
  asOf?: string;

  @ApiPropertyOptional({
    description: 'Optional building filter',
  })
  @IsOptional()
  @IsString()
  buildingId?: string;
}

/**
 * Query params for debt by-period report.
 */
export class DebtByPeriodQueryDto {
  @ApiPropertyOptional({
    description: 'Debt cut date in YYYY-MM-DD format',
    example: '2026-04-19',
  })
  @IsOptional()
  @IsString()
  @Matches(ISO_LOCAL_DATE_REGEX)
  asOf?: string;

  @ApiPropertyOptional({
    description: 'Optional building filter',
  })
  @IsOptional()
  @IsString()
  buildingId?: string;
}

export interface DebtAgingBuckets {
  '0_30': number;
  '31_60': number;
  '61_90': number;
  '90_plus': number;
}

export interface DebtAgingResponsible {
  memberId: string;
  name: string;
  role: string;
}

export interface DebtAgingWorstCase {
  unitId: string;
  unitLabel: string;
  period: string;
  dueDate: string;
  outstanding: number;
}

export interface DebtAgingRow {
  unitId: string;
  buildingId: string;
  unitLabel: string;
  responsable: DebtAgingResponsible | null;
  overdueTotal: number;
  bucket: keyof DebtAgingBuckets;
  oldestUnpaidDueDate: string;
  oldestUnpaidPeriod: string;
  lastPaymentDate: string | null;
}

export interface DebtAgingResponseDto {
  asOf: string;
  totalOverdue: number;
  unitsMorosas: number;
  buckets: DebtAgingBuckets;
  worstCase: DebtAgingWorstCase | null;
  rowsByUnit: DebtAgingRow[];
}

export interface DebtByPeriodPeriodRow {
  period: string;
  dueDate: string;
  charged: number;
  allocatedPaid: number;
  outstanding: number;
}

export interface DebtByPeriodUnitRow {
  unitId: string;
  buildingId: string;
  unitLabel: string;
  responsable: DebtAgingResponsible | null;
  totalOverdue: number;
  periods: DebtByPeriodPeriodRow[];
  oldestUnpaidPeriod: string;
  oldestUnpaidDueDate: string;
  lastPaymentDate: string | null;
}

export interface DebtByPeriodResponseDto {
  asOf: string;
  rowsByUnit: DebtByPeriodUnitRow[];
}

export class DebtAgingApiResponseDto {
  @ApiProperty()
  asOf!: string;

  @ApiProperty()
  totalOverdue!: number;

  @ApiProperty()
  unitsMorosas!: number;

  @ApiProperty({
    example: {
      '0_30': 120000,
      '31_60': 50000,
      '61_90': 20000,
      '90_plus': 15000,
    },
  })
  buckets!: DebtAgingBuckets;

  @ApiProperty({
    nullable: true,
    required: false,
  })
  worstCase!: DebtAgingWorstCase | null;

  @ApiProperty({ isArray: true })
  rowsByUnit!: DebtAgingRow[];
}

export class DebtByPeriodApiResponseDto {
  @ApiProperty()
  asOf!: string;

  @ApiProperty({ isArray: true })
  rowsByUnit!: DebtByPeriodUnitRow[];
}
