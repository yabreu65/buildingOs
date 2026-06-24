export type CanonicalFinancePeriodKind =
  | 'current_month'
  | 'previous_month'
  | 'named_month'
  | 'relative_range'
  | 'month_range'
  | 'year_to_date'
  | 'accumulated'
  | 'unknown';

export type RelativeRangeMode = 'including_current' | 'closed_months' | 'unknown';

export interface CanonicalFinancePeriod {
  kind: CanonicalFinancePeriodKind;
  amount: number | null;
  unit: 'month' | null;
  mode: RelativeRangeMode | null;
  month: number | null;
  year: number | null;
  startMonth: number | null;
  startYear: number | null;
  endMonth: number | null;
  endYear: number | null;
}

export interface ResolvedFinancePeriod {
  kind: 'single_period' | 'period_range' | 'accumulated' | 'unknown';
  periods: string[];
  period: string | null;
  startPeriod: string | null;
  endPeriod: string | null;
  startDate: Date | null;
  endDate: Date | null;
  label: string;
}

export interface PeriodValidationResult {
  valid: boolean;
  requiresClarification: boolean;
  missingFields: string[];
  clarificationMessage?: string;
  normalizedPeriod: CanonicalFinancePeriod | null;
}
