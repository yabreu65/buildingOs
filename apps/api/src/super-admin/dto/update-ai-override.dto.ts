import { IsNumber, IsBoolean, IsOptional, Min, Max } from 'class-validator';

/**
 * Phase 13: Update AI overrides for a tenant
 * null values reset the override to plan defaults
 */
export class UpdateAiOverrideDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500000)
  monthlyBudgetCents?: number | null; // null = reset to plan default

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(9999)
  monthlyCallsLimit?: number | null; // null = reset to plan default

  @IsOptional()
  @IsBoolean()
  allowBigModelOverride?: boolean | null; // null = reset to plan default
}
